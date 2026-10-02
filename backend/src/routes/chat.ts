import { Router, Request, Response } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { db } from '../db/client';
import { agents, type Agent } from '../db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router();

const ORG = () => process.env.OKTA_ORG_URL!;
const BACKEND_PUBLIC_URL = () => process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000';

const CAMPAIGNS_SCOPES = 'api.read api.search api.create api.update api.delete';

function decodeIdToken(jwt: string): any {
  const [, payloadB64] = jwt.split('.');
  return JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

// ── Per-agent login (User Access) ────────────────────────────────────────────
// Chat's subject token has to be an id_token issued by the SELECTED AGENT'S OWN backing app —
// not the dashboard's own NextAuth login app, which Okta rejects since it was never linked as a
// delegation caller. Logging in directly against the agent's own app needs no such registration
// (self-authorized), same pattern as the Exercise page's real User Access flow in exercise.ts
// (separate in-memory maps here rather than importing exercise.ts's, since those are private to
// that file's stepwise-click flow).
const pendingLogins = new Map<string, { codeVerifier: string; agentId: string; clientId: string; createdAt: number }>();

// One hop per agent in the resolved A2A chain — hops[i] is performed BY agentChain[i]; every hop
// but the last targets the next agent in the chain, the last targets the Campaigns authorization
// server itself. redemption is optional because a hop whose EXCHANGE itself failed never reaches
// redemption at all — the trace still records that hop (with just the failed exchange) so the
// graph's red error chip lands on the exact hop that failed, instead of the whole trace vanishing.
interface ChatHopTrace { agentId: string; agentName: string; exchange: okta.ExerciseTokenResult; redemption?: okta.ExerciseTokenResult; }
interface ChatTokenTrace { hops: ChatHopTrace[]; }

interface ChatSession {
  agentId: string; idToken: string; createdAt: number;
  campaignsAccessToken?: string;
  campaignsTokenExpiresAt?: number;
  tokenTrace?: ChatTokenTrace;
  // Decoded claims only — the raw id_token string never leaves login/callback's own scope, same
  // as every other decoded-claims response in this app (e.g. exercise.ts's /user-access/result).
  login?: okta.ExerciseTokenResult;
}
const chatSessions = new Map<string, ChatSession>();

function pruneExpired<T extends { createdAt: number }>(map: Map<string, T>, maxAgeMs: number) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > maxAgeMs) map.delete(key);
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Runs `fn` over `items` with at most `limit` in flight at once — checking every onboarded agent's
// connections for /eligible-agents via a single Promise.all burns through Okta's per-endpoint
// rate limit in one burst on any org with a few dozen agents, 429-ing most of the batch —
// listAgentConnections silently treats a 429 as "no connections", so the whole picker would
// intermittently come back empty. A small concurrency cap keeps every request under budget.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Short-lived cache — connection state changes rarely, so it's safe to reuse the last result for
// a few seconds instead of re-querying Okta for every onboarded agent on every picker open.
let eligibleAgentsCache: { value: any[]; expiresAt: number } | null = null;

function hasDirectCampaignsConnection(connections: okta.AgentConnection[], campaignsIssuer: string): boolean {
  return connections.some(
    (c) => c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS' && c.status === 'ACTIVE' && c.authorizationServer?.issuerUrl === campaignsIssuer
  );
}

async function findAgentByOktaId(oktaAgentId: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.oktaAgentId, oktaAgentId));
  return row;
}

// GET /api/chat/eligible-agents — an agent can chat if it can reach the configured Campaigns
// authorization server either directly, or through a CHAIN of ACTIVE agent-to-agent (A2A)
// connections of any length ending at an agent with a direct connection (see
// resolveCampaignsAccessPath below). Reachability here is a reverse fixpoint over the same
// in-memory connections-by-agent map every candidate needed anyway — no extra Okta calls no
// matter how deep a chain runs.
router.get('/eligible-agents', async (_req: Request, res: Response) => {
  try {
    if (eligibleAgentsCache && eligibleAgentsCache.expiresAt > Date.now()) {
      return res.json(eligibleAgentsCache.value);
    }

    const campaignsAuthServerId = process.env.CHAT_CAMPAIGNS_AUTH_SERVER_ID;
    if (!campaignsAuthServerId) return res.json([]);
    const campaignsAS = await okta.getAuthorizationServer(campaignsAuthServerId);
    if (!campaignsAS.issuer) return res.json([]);

    const all = await db.select().from(agents).where(isNotNull(agents.oktaAgentId));
    const connectionsByOktaId = new Map<string, okta.AgentConnection[]>();
    await mapWithConcurrency(all, 5, async (a) => {
      const connections = await okta.listAgentConnections(a.oktaAgentId!).catch(() => []);
      connectionsByOktaId.set(a.oktaAgentId!, connections);
    });

    const directOktaIds = new Set(
      all.filter((a) => hasDirectCampaignsConnection(connectionsByOktaId.get(a.oktaAgentId!) || [], campaignsAS.issuer!)).map((a) => a.oktaAgentId!)
    );

    const adjacency = new Map<string, string[]>();
    for (const a of all) {
      const targets = (connectionsByOktaId.get(a.oktaAgentId!) || [])
        .filter((c) => c.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER' && c.status === 'ACTIVE')
        .map((c) => c.resource?.orn?.split(':').pop())
        .filter((id): id is string => !!id);
      adjacency.set(a.oktaAgentId!, targets);
    }
    const reachable = new Set(directOktaIds);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [oktaId, targets] of adjacency) {
        if (!reachable.has(oktaId) && targets.some((t) => reachable.has(t))) { reachable.add(oktaId); changed = true; }
      }
    }

    const eligible = all.filter((a) => reachable.has(a.oktaAgentId!));

    const result = eligible.map((a) => ({ id: a.id, name: a.name, description: a.description }));
    eligibleAgentsCache = { value: result, expiresAt: Date.now() + 30_000 };
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/:agentId/session/:loginRid — lets the frontend check whether a loginRid it has
// cached in sessionStorage is still valid before trusting it (e.g. after a backend restart wipes
// the in-memory chatSessions map — sessionStorage would otherwise still claim "already logged in"
// with no way to detect that and no network request ever firing to reveal it).
router.get('/:agentId/session/:loginRid', (req: Request, res: Response) => {
  const session = chatSessions.get(req.params.loginRid);
  const valid = !!session && session.agentId === req.params.agentId;
  // res.json()/res.send() compute an ETag and honor If-None-Match automatically, which would
  // return a stale 304 reusing whatever "valid" value the browser cached on the FIRST check.
  // res.end() bypasses that entirely.
  res.type('application/json');
  const tokenTrace = valid ? session!.tokenTrace : undefined;
  res.end(JSON.stringify(valid ? { valid, login: session!.login, tokenTrace } : { valid }));
});

// POST /api/chat/:agentId/session/:loginRid/logout
router.post('/:agentId/session/:loginRid/logout', (req: Request, res: Response) => {
  const session = chatSessions.get(req.params.loginRid);
  if (session && session.agentId === req.params.agentId) chatSessions.delete(req.params.loginRid);
  res.json({ ok: true });
});

// GET /api/chat/:agentId/access-path — resolves and returns just the AGENT CHAIN shape (dashboard
// ids/names only, no tokens) that a real chat message would use, via the exact same
// resolveCampaignsAccessPath BFS. Lets the frontend render the full token-flow graph's nodes as
// soon as an agent is selected, instead of only after the first real exchange.
router.get('/:agentId/access-path', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.agentId));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const campaignsAuthServerId = process.env.CHAT_CAMPAIGNS_AUTH_SERVER_ID;
    if (!campaignsAuthServerId) return res.json({ agentChain: [] });
    const campaignsAS = await okta.getAuthorizationServer(campaignsAuthServerId);
    if (!campaignsAS.issuer) return res.json({ agentChain: [] });

    const path = await resolveCampaignsAccessPath(agent, campaignsAS.issuer);
    if (!path) return res.json({ agentChain: [] });
    res.json({ agentChain: path.agentChain.map((a) => ({ agentId: a.id, agentName: a.name })) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/chat/:agentId/login/start
router.post('/:agentId/login/start', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.agentId));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const appId = await okta.ensureUserAccess(agent.oktaAgentId);
    const redirectUri = `${BACKEND_PUBLIC_URL()}/api/chat/login/callback`;
    const { clientId, clientSecret } = await okta.setAppAuthMethodAndRedirect(appId, redirectUri);
    // Only persisted when Okta actually issued one (client_secret_basic branch) — a private_key_jwt
    // agent's existing testPrivateKeyPem/testPrivateKeyKid is left alone and used instead, via
    // resolveCallerCred below.
    if (clientSecret) await db.update(agents).set({ testClientSecret: clientSecret }).where(eq(agents.id, agent.id));

    pruneExpired(pendingLogins, 10 * 60 * 1000);
    const codeVerifier = base64url(randomBytes(32));
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const state = randomUUID();
    pendingLogins.set(state, { codeVerifier, agentId: agent.id, clientId, createdAt: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid profile',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    res.json({ authorizeUrl: `${ORG()}/oauth2/v1/authorize?${params.toString()}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/chat/login/callback — Okta redirects here after login
router.get('/login/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  const redirectUri = `${BACKEND_PUBLIC_URL()}/api/chat/login/callback`;

  if (error) {
    return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent(error_description || error)}`);
  }
  const pending = state ? pendingLogins.get(state) : undefined;
  if (!pending || !code) {
    return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent('Login session expired or invalid — please try again')}`);
  }
  pendingLogins.delete(state);

  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, pending.agentId));
    if (!agent) return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent('Agent not found')}`);
    const cred = resolveCallerCred(agent);
    const result = await okta.postToken(
      `${ORG()}/oauth2/v1/token`, pending.clientId, cred,
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: pending.codeVerifier },
      'Chat: User Login (Authorization Code)'
    );
    const body = result.raw as any;
    if (!result.ok || !body.id_token) {
      return res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent(body?.error_description || body?.error || 'Token exchange failed')}`);
    }

    pruneExpired(chatSessions, 60 * 60 * 1000);
    const rid = randomUUID();
    const login: okta.ExerciseTokenResult = {
      ok: true, status: 200,
      decoded: { header: {}, payload: decodeIdToken(body.id_token) },
      raw: { note: 'User login (ID token)' },
    };
    chatSessions.set(rid, { agentId: pending.agentId, idToken: body.id_token, createdAt: Date.now(), login });
    res.redirect(`${FRONTEND_URL()}/chat?loginResult=${rid}&agentId=${pending.agentId}`);
  } catch (e: any) {
    res.redirect(`${FRONTEND_URL()}/chat?loginError=${encodeURIComponent(e.message)}`);
  }
});

function resolveCallerCred(agent: Pick<Agent, 'testClientSecret' | 'testPrivateKeyPem' | 'testPrivateKeyKid'>): okta.AgentTestCredential {
  return agent.testPrivateKeyPem && agent.testPrivateKeyKid
    ? { privateKeyPem: agent.testPrivateKeyPem, privateKeyKid: agent.testPrivateKeyKid }
    : { clientSecret: agent.testClientSecret! };
}

// Onboarded agents don't automatically get a persisted testClientSecret/testPrivateKeyPem — only
// the Exercise page's real User Access login flow does that today. Lazily provision one here the
// first time an agent is used in chat.
async function ensureCallerCredential(agent: Agent): Promise<okta.AgentTestCredential> {
  if (agent.testPrivateKeyPem && agent.testPrivateKeyKid) return resolveCallerCred(agent);
  if (agent.testClientSecret) return resolveCallerCred(agent);

  const oktaAgent = await okta.getAIAgent(agent.oktaAgentId!);
  let clientSecret: string;
  if (okta.isAppBackedAgent(oktaAgent)) {
    const rotated = await okta.rotateAppSecret(oktaAgent.appId!);
    clientSecret = rotated.clientSecret;
  } else {
    const created = await okta.createAgentSecret(agent.oktaAgentId!);
    clientSecret = created.clientSecret;
  }
  await db.update(agents).set({ testClientSecret: clientSecret }).where(eq(agents.id, agent.id));
  return { clientSecret };
}

// agentChain[0] is the primary agent; agentChain[i] reaches agentChain[i+1] via a2aConnections[i];
// agentChain[last] is the one with the direct Campaigns connection. agentChain.length === 1
// (a2aConnections === []) means the primary agent itself has the direct connection.
interface CampaignsAccessPath { agentChain: Agent[]; a2aConnections: okta.AgentConnection[]; }

const MAX_A2A_HOPS = 10;

// Resolves how `agent` can reach the Campaigns MCP server: a breadth-first search over ACTIVE
// agent-to-agent connections of any depth (capped at MAX_A2A_HOPS, with a visited set guarding
// against cycles), stopping at the first agent found with a direct connection to campaignsIssuer.
// Returns null if no such chain exists within the depth cap.
async function resolveCampaignsAccessPath(agent: Agent, campaignsIssuer: string): Promise<CampaignsAccessPath | null> {
  const startConnections = await okta.listAgentConnections(agent.oktaAgentId!);
  if (hasDirectCampaignsConnection(startConnections, campaignsIssuer)) return { agentChain: [agent], a2aConnections: [] };

  interface QueueItem { connections: okta.AgentConnection[]; chain: Agent[]; links: okta.AgentConnection[]; }
  let queue: QueueItem[] = [{ connections: startConnections, chain: [agent], links: [] }];
  const visited = new Set<string>([agent.oktaAgentId!]);

  for (let depth = 0; depth < MAX_A2A_HOPS && queue.length > 0; depth++) {
    const nextQueue: QueueItem[] = [];
    for (const item of queue) {
      for (const c of item.connections) {
        if (c.connectionType !== 'IDENTITY_ASSERTION_A2A_SERVER' || c.status !== 'ACTIVE') continue;
        const targetOktaId = c.resource?.orn?.split(':').pop();
        if (!targetOktaId || visited.has(targetOktaId)) continue;
        visited.add(targetOktaId);
        const nextAgent = await findAgentByOktaId(targetOktaId);
        if (!nextAgent?.oktaAgentId) continue;
        const nextConnections = await okta.listAgentConnections(nextAgent.oktaAgentId).catch(() => []);
        const chain = [...item.chain, nextAgent];
        const links = [...item.links, c];
        if (hasDirectCampaignsConnection(nextConnections, campaignsIssuer)) return { agentChain: chain, a2aConnections: links };
        nextQueue.push({ connections: nextConnections, chain, links });
      }
    }
    queue = nextQueue;
  }
  return null;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface ToolCallRecord { name: string; args: any; result: any; }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Calls Claude with the current message history + the Campaigns MCP's tools translated to
// Anthropic's tool-use schema, looping on tool_use blocks until Claude replies with plain text
// or the iteration cap is hit.
async function runChatTurn(
  history: ChatMessage[], userMessage: string, mcpClient: Client
): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
  const { tools: mcpTools } = await mcpClient.listTools();
  const anthropicTools = mcpTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const systemPrompt = `You are a helpful assistant that manages marketing campaigns via the available tools. Use tools to create, search, read, update, and delete campaigns. Never fabricate campaign data — always use a tool to look it up first.

CRITICAL FORMATTING RULE: The chat UI automatically renders a visual card for every campaign object a tool call returns (with its name, status, description, budget, and dates). Your text reply is shown ABOVE those cards, so you must NEVER repeat any campaign field — no name, status, budget, dates, description, ID, list, bullet points, or table — anywhere in your reply. This applies even when listing multiple campaigns. Your reply must be ONLY a short conversational sentence with no campaign data in it, for example: "Here's your current campaign." or "Found 3 campaigns — take a look below." or "Done, I've created that campaign." or "Updated." Nothing else.`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: 'user', content: userMessage },
  ];

  const toolCalls: ToolCallRecord[] = [];
  const MAX_ITERATIONS = 5;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS, 10) : 1000,
      system: systemPrompt,
      messages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });
    messages.push({ role: 'assistant', content: response.content });

    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      return { reply: textBlock?.text || 'I was unable to generate a response.', toolCalls };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUseBlocks) {
      let result: any;
      try {
        result = await mcpClient.callTool({ name: call.name, arguments: call.input as Record<string, unknown> });
      } catch (e: any) {
        result = { isError: true, content: [{ type: 'text', text: e.message }] };
      }
      toolCalls.push({ name: call.name, args: call.input, result });
      toolResults.push({
        type: 'tool_result', tool_use_id: call.id,
        content: JSON.stringify(result), is_error: !!result.isError,
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { reply: 'I was unable to complete your request after multiple attempts. Please try again.', toolCalls };
}

// POST /api/chat/:agentId/message — loginRid identifies a completed per-agent login (see
// /login/start and /login/callback above); the id_token itself never leaves the backend.
router.post('/:agentId/message', async (req: Request, res: Response) => {
  const { loginRid, message, history } = req.body as { loginRid: string; message: string; history?: ChatMessage[] };
  if (!loginRid || !message) return res.status(400).json({ error: 'loginRid and message are required' });

  try {
    const session = chatSessions.get(loginRid);
    if (!session || session.agentId !== req.params.agentId) {
      return res.status(401).json({ error: 'Not logged in for this agent — please log in first', requiresLogin: true });
    }
    const subjectIdToken = session.idToken;

    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.agentId));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const campaignsAuthServerId = process.env.CHAT_CAMPAIGNS_AUTH_SERVER_ID;
    if (!campaignsAuthServerId) {
      return res.status(400).json({ error: 'CHAT_CAMPAIGNS_AUTH_SERVER_ID is not configured on the backend' });
    }
    const campaignsAS = await okta.getAuthorizationServer(campaignsAuthServerId);
    if (!campaignsAS.issuer) return res.status(500).json({ error: 'Could not resolve the campaigns authorization server issuer' });

    // Reuse the cached campaigns access token across turns instead of re-running the full XAA
    // chain on every message — only re-minted once it's actually expired (with a small safety margin).
    let accessToken = session.campaignsAccessToken;
    const isExpired = !session.campaignsTokenExpiresAt || Date.now() > session.campaignsTokenExpiresAt - 30_000;
    if (!accessToken || isExpired) {
      const path = await resolveCampaignsAccessPath(agent, campaignsAS.issuer);
      if (!path) {
        return res.status(400).json({ error: 'This agent has no connection to the Campaigns authorization server, directly or through another agent — configure one from the Resources tab first' });
      }

      // One iteration per agent in the resolved chain — every hop but the last targets the NEXT
      // agent in the chain (via its A2A connection's own resource/authorization server, no scope,
      // matching Exercise's own A2A hop default of 'agent.invoke'); the last hop targets the
      // Campaigns AS itself, with the real requested scope.
      const hops: ChatHopTrace[] = [];
      let subjectToken = subjectIdToken;
      let subjectTokenType = 'urn:ietf:params:oauth:token-type:id_token';
      let finalAccessToken = '';

      for (let i = 0; i < path.agentChain.length; i++) {
        const hopAgent = path.agentChain[i];
        const isLastHop = i === path.agentChain.length - 1;
        const cred = await ensureCallerCredential(hopAgent);
        const audience = isLastHop ? campaignsAS.issuer : path.a2aConnections[i].authorizationServer!.issuerUrl;
        const resource = isLastHop ? undefined : path.a2aConnections[i].resourceIndicator;
        const scope = isLastHop ? CAMPAIGNS_SCOPES : undefined;

        const exchange = await okta.runIdJagExchange(`${ORG()}/oauth2/v1/token`, hopAgent.oktaAgentId!, cred, subjectToken, resource, audience, subjectTokenType, scope);
        if (!exchange.ok || !exchange.accessToken) {
          hops.push({ agentId: hopAgent.id, agentName: hopAgent.name, exchange });
          session.tokenTrace = { hops };
          return res.status(400).json({ error: exchange.raw?.error_description || exchange.raw?.error || 'Token exchange failed', step: exchange, tokenTrace: session.tokenTrace, login: session.login });
        }

        const redemption = await okta.runJwtBearerRedemption(`${audience}/v1/token`, hopAgent.oktaAgentId!, cred, exchange.accessToken);
        if (!redemption.ok || !redemption.accessToken) {
          hops.push({ agentId: hopAgent.id, agentName: hopAgent.name, exchange, redemption });
          session.tokenTrace = { hops };
          return res.status(400).json({ error: redemption.raw?.error_description || redemption.raw?.error || 'Token redemption failed', step: redemption, tokenTrace: session.tokenTrace, login: session.login });
        }

        hops.push({ agentId: hopAgent.id, agentName: hopAgent.name, exchange, redemption });
        subjectToken = redemption.accessToken;
        subjectTokenType = 'urn:ietf:params:oauth:token-type:access_token';
        if (isLastHop) {
          finalAccessToken = redemption.accessToken;
          session.campaignsTokenExpiresAt = typeof redemption.decoded?.payload?.exp === 'number' ? redemption.decoded.payload.exp * 1000 : Date.now() + 60 * 60 * 1000;
        }
      }

      session.tokenTrace = { hops };
      accessToken = finalAccessToken;
      session.campaignsAccessToken = accessToken;
    }

    const transport = new StreamableHTTPClientTransport(new URL(`${BACKEND_PUBLIC_URL()}/mcp/campaigns`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}`, 'x-campaigns-issuer': campaignsAS.issuer } },
    });
    const mcpClient = new Client({ name: 'okta-agent-platform-chat', version: '1.0.0' });
    await mcpClient.connect(transport);

    try {
      const { reply, toolCalls } = await runChatTurn(history || [], message, mcpClient);
      res.json({ reply, toolCalls, tokenTrace: session.tokenTrace, login: session.login });
    } finally {
      await mcpClient.close();
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
