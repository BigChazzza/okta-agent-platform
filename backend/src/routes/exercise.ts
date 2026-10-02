import { Router, Request, Response } from 'express';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { db } from '../db/client';
import { agents, type Agent } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router();

const ORG = () => process.env.OKTA_ORG_URL!;
const BACKEND_PUBLIC_URL = () => process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:3000';

// Okta normalizes an ORN's env segment (position 1) to "okta" once it's stored on a delegation
// link, regardless of what was sent when the link was created — but agentOrnFromLinks derives an
// ORN from the org's own hostname-based _links, which still says "oktapreview". Comparing ORNs
// for equality has to ignore that segment or every match silently fails.
function ornsMatch(a: string, b: string): boolean {
  const normalize = (orn: string) => orn.split(':').map((seg, i) => (i === 1 ? 'okta' : seg)).join(':');
  return normalize(a) === normalize(b);
}

// GET /api/exercise/config — non-secret config the frontend graph needs to recognize which app
// node IS the configured service client (so it can render as the Machine Access "start here"
// node instead of a generic app caller).
router.get('/config', (_req: Request, res: Response) => {
  res.json({ serviceClientId: process.env.EXERCISE_SERVICE_CLIENT_ID || null });
});

// ── Machine Access: get the initial subject token (step 1 only) ─────────────

// POST /api/exercise/agents/:id/machine-access/token — :id is the agent that will act on its
// own behalf downstream (the intermediary). Gets a client_credentials access token scoped to
// this agent's own resource from the configured service client, and stashes it in the shared
// `results` map so /agents/exercise/exchange can use it as the subject token for a later hop.
router.post('/agents/:id/machine-access/token', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const serviceClientId = process.env.EXERCISE_SERVICE_CLIENT_ID;
    const serviceClientSecret = process.env.EXERCISE_SERVICE_CLIENT_SECRET;
    const sharedAuthServerId = process.env.EXERCISE_SHARED_AUTH_SERVER_ID;
    if (!serviceClientId || !serviceClientSecret) {
      return res.status(400).json({ error: 'EXERCISE_SERVICE_CLIENT_ID / EXERCISE_SERVICE_CLIENT_SECRET are not configured on the backend' });
    }
    if (!sharedAuthServerId) {
      return res.status(400).json({ error: 'EXERCISE_SHARED_AUTH_SERVER_ID is not configured on the backend' });
    }

    const authServer = await okta.getAuthorizationServer(sharedAuthServerId);
    if (!authServer.issuer) return res.status(500).json({ error: 'Could not resolve the shared authorization server issuer' });
    const authServerTokenEndpoint = `${authServer.issuer}/v1/token`;

    // Scoped to the agent's OWN resource — a later delegation link authorizes the service client
    // to call this agent specifically, so the token's audience/resource has to match for that
    // delegation policy to recognize it in the next hop.
    const resourceUrl = await okta.getAgentResourceUrl(agent.oktaAgentId);
    if (!resourceUrl) return res.status(400).json({ error: 'Agent has no resourceUrl configured yet' });

    const step1 = await okta.runServiceClientGrant(authServerTokenEndpoint, serviceClientId, serviceClientSecret, resourceUrl);
    if (!step1.ok || !step1.accessToken) return res.json({ step1 });

    pruneExpired(results, 10 * 60 * 1000);
    const rid = randomUUID();
    results.set(rid, {
      decoded: { accessToken: step1.decoded },
      rawToken: step1.accessToken,
      rawTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      agentId: agent.id,
      createdAt: Date.now(),
    });
    res.json({ step1, rid });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── User Access: real Authorization Code + PKCE login test ──────────────────

// In-memory only — test logins are short-lived, scoped tightly to this file.
const pendingLogins = new Map<string, { codeVerifier: string; agentId: string; clientId: string; createdAt: number }>();
const results = new Map<string, { decoded: any; rawToken: string; rawTokenType: string; agentId: string; createdAt: number }>();

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pruneExpired<T extends { createdAt: number }>(map: Map<string, T>, maxAgeMs: number) {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > maxAgeMs) map.delete(key);
  }
}

// POST /api/exercise/agents/:id/user-access/start
router.post('/agents/:id/user-access/start', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const appId = await okta.ensureUserAccess(agent.oktaAgentId);
    const redirectUri = `${BACKEND_PUBLIC_URL()}/api/exercise/agents/user-access/callback`;
    const { clientId, clientSecret } = await okta.setAppAuthMethodAndRedirect(appId, redirectUri);
    // Only persisted when Okta actually issued one (client_secret_basic branch) — a private_key_jwt
    // agent's existing testPrivateKeyPem/testPrivateKeyKid is left alone and used instead, via
    // resolveCallerCred in the exchange/redeem routes below.
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

// GET /api/exercise/agents/user-access/callback — Okta redirects here after login
router.get('/agents/user-access/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  const redirectUri = `${BACKEND_PUBLIC_URL()}/api/exercise/agents/user-access/callback`;

  if (error) {
    return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent(error_description || error)}`);
  }
  const pending = state ? pendingLogins.get(state) : undefined;
  if (!pending || !code) {
    return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent('Login session expired or invalid — please try again')}`);
  }
  pendingLogins.delete(state);

  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, pending.agentId));
    if (!agent) return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent('Agent not found')}`);
    const cred = resolveCallerCred(agent);
    const result = await okta.postToken(
      `${ORG()}/oauth2/v1/token`, pending.clientId, cred,
      { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: pending.codeVerifier },
      'Exercise: User Login (Authorization Code)'
    );
    if (!result.ok) {
      return res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent(result.raw?.error_description || result.raw?.error || 'Token exchange failed')}`);
    }
    const body = result.raw;

    const decode = (jwt?: string) => {
      if (!jwt) return undefined;
      const [, payloadB64] = jwt.split('.');
      return JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    };

    pruneExpired(results, 10 * 60 * 1000);
    const rid = randomUUID();
    results.set(rid, {
      decoded: {
        idToken: decode(body.id_token),
        accessToken: decode(body.access_token),
      },
      rawToken: body.id_token,
      rawTokenType: 'urn:ietf:params:oauth:token-type:id_token',
      agentId: pending.agentId,
      createdAt: Date.now(),
    });
    res.redirect(`${FRONTEND_URL()}/exercise?result=${rid}`);
  } catch (e: any) {
    res.redirect(`${FRONTEND_URL()}/exercise?error=${encodeURIComponent(e.message)}`);
  }
});

// GET /api/exercise/agents/user-access/result/:rid — returns decoded claims only, never the raw
// token. Not deleted on read — the raw token needs to survive so /agents/exercise/exchange can
// use it, and expires via the existing 10-minute TTL instead.
router.get('/agents/user-access/result/:rid', (req: Request, res: Response) => {
  const result = results.get(req.params.rid);
  if (!result) return res.status(404).json({ error: 'Result not found or expired' });
  // agentId is included so the frontend can restore which agent this login was for — the
  // redirect back from Okta is a full page navigation, so client state doesn't survive it.
  res.json({ ...result.decoded, agentId: result.agentId });
});

// ── Graph UI: split hop, one Okta call per click ─────────────────────────────
// The graph's click model triggers the exchange (id-jag) on the CALLER node's click and the
// redemption (final token) on the TARGET node's click, mirroring the real two-request mechanics.

function resolveCallerCred(caller: Pick<Agent, 'testClientSecret' | 'testPrivateKeyPem' | 'testPrivateKeyKid'>): okta.AgentTestCredential {
  return caller.testPrivateKeyPem && caller.testPrivateKeyKid
    ? { privateKeyPem: caller.testPrivateKeyPem, privateKeyKid: caller.testPrivateKeyKid }
    : { clientSecret: caller.testClientSecret! };
}

interface PendingExchange {
  callerAgentId: string; authServerTokenEndpoint: string; idJag: string;
  kind: 'agent' | 'authserver'; targetAgentDashboardId?: string; createdAt: number;
}
const pendingExchanges = new Map<string, PendingExchange>();

// POST /api/exercise/agents/exercise/exchange — { rid, targetAgentId } (agent hop) or
// { rid, connectionId } (authserver hop). Runs only the token-exchange half of a hop and
// stashes the resulting id-jag for a later /redeem call.
router.post('/agents/exercise/exchange', async (req: Request, res: Response) => {
  const { rid, targetAgentId, connectionId, scope } = req.body;
  if (!rid || (!targetAgentId && !connectionId)) {
    return res.status(400).json({ error: 'rid and either targetAgentId or connectionId are required' });
  }
  try {
    const result = results.get(rid);
    if (!result) return res.status(404).json({ error: 'Token expired — please get a new one' });

    const [caller] = await db.select().from(agents).where(eq(agents.id, result.agentId));
    if (!caller?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    if (!caller.testClientSecret && !(caller.testPrivateKeyPem && caller.testPrivateKeyKid)) {
      return res.status(400).json({ error: 'No credential stored for this agent yet' });
    }
    const callerCred = resolveCallerCred(caller);
    const orgTokenEndpoint = `${ORG()}/oauth2/v1/token`;

    let step2: okta.ExerciseTokenResult;
    let authServerTokenEndpoint: string;
    let kind: 'agent' | 'authserver';
    let targetAgentDashboardId: string | undefined;

    if (targetAgentId) {
      const [target] = await db.select().from(agents).where(eq(agents.id, targetAgentId));
      if (!target?.oktaAgentId) return res.status(404).json({ error: 'Target agent not found' });

      const callerOktaAgent = await okta.getAIAgent(caller.oktaAgentId);
      const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
      if (!callerOrn) return res.status(400).json({ error: 'Could not resolve the logged-in agent\'s ORN' });

      const targetOktaAgent = await okta.getAIAgent(target.oktaAgentId);
      const targetOrn = okta.agentOrnFromLinks(targetOktaAgent._links);
      if (!targetOrn) return res.status(400).json({ error: 'Could not resolve the target agent\'s ORN' });

      const links = await okta.listDelegationLinksFrom(callerOrn);
      const link = links.find((l) => ornsMatch(l.targetOrn, targetOrn));
      if (!link) return res.status(400).json({ error: 'This agent is not authorized to call the selected target — configure Machine Access first' });
      const authServerId = link.authorizationServerOrn.split(':').pop();
      if (!authServerId) return res.status(500).json({ error: 'Could not resolve the delegation link\'s authorization server' });
      const authServer = await okta.getAuthorizationServer(authServerId);
      if (!authServer.issuer) return res.status(500).json({ error: 'Could not resolve the authorization server issuer' });

      const targetResourceUrl = await okta.getAgentResourceUrl(target.oktaAgentId);
      if (!targetResourceUrl) return res.status(400).json({ error: 'Target agent has no resourceUrl configured yet' });

      authServerTokenEndpoint = `${authServer.issuer}/v1/token`;
      kind = 'agent';
      targetAgentDashboardId = target.id;
      step2 = await okta.runIdJagExchange(
        orgTokenEndpoint, caller.oktaAgentId, callerCred, result.rawToken, targetResourceUrl, authServer.issuer,
        result.rawTokenType
      );
    } else {
      const connections = await okta.listAgentConnections(caller.oktaAgentId);
      const connection = connections.find((c) => c.id === connectionId && c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS');
      if (!connection?.authorizationServer?.issuerUrl || !connection.resourceIndicator) {
        return res.status(400).json({ error: 'Authorization server connection not found or missing issuer/resource' });
      }
      authServerTokenEndpoint = `${connection.authorizationServer.issuerUrl}/v1/token`;
      kind = 'authserver';
      // Unlike the agent case, a Custom AS exchange must NOT send `resource`. scope comes from
      // the graph's own scope selection — falls back to runIdJagExchange's 'agent.invoke' default.
      step2 = await okta.runIdJagExchange(
        orgTokenEndpoint, caller.oktaAgentId, callerCred, result.rawToken,
        undefined, connection.authorizationServer.issuerUrl, result.rawTokenType, scope || undefined
      );
    }

    if (!step2.ok || !step2.accessToken) return res.json({ step2 });

    pruneExpired(pendingExchanges, 10 * 60 * 1000);
    const exchangeRid = randomUUID();
    pendingExchanges.set(exchangeRid, {
      callerAgentId: caller.oktaAgentId, authServerTokenEndpoint, idJag: step2.accessToken,
      kind, targetAgentDashboardId, createdAt: Date.now(),
    });
    res.json({ step2, exchangeRid });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/exercise/agents/exercise/redeem — { exchangeRid }: the redemption half of a hop,
// triggered by clicking the TARGET node once its caller's /exchange has already run. Re-resolves
// the caller's stored credential (not carried in pendingExchanges — credentials can be regenerated
// between clicks) and redeems the stashed id-jag.
router.post('/agents/exercise/redeem', async (req: Request, res: Response) => {
  const { exchangeRid } = req.body;
  if (!exchangeRid) return res.status(400).json({ error: 'exchangeRid is required' });
  try {
    const pending = pendingExchanges.get(exchangeRid);
    if (!pending) return res.status(404).json({ error: 'Exchange expired — please run it again' });
    pendingExchanges.delete(exchangeRid);

    const [caller] = await db.select().from(agents).where(eq(agents.oktaAgentId, pending.callerAgentId));
    if (!caller) return res.status(404).json({ error: 'Agent not found' });
    if (!caller.testClientSecret && !(caller.testPrivateKeyPem && caller.testPrivateKeyKid)) {
      return res.status(400).json({ error: 'No credential stored for this agent yet' });
    }
    const callerCred = resolveCallerCred(caller);

    const step3 = await okta.runJwtBearerRedemption(pending.authServerTokenEndpoint, pending.callerAgentId, callerCred, pending.idJag);
    if (!step3.ok || !step3.accessToken || pending.kind === 'authserver') return res.json({ step3 });

    // Agent hop — stash the delegated token under the TARGET agent so the graph can move the
    // path onto it and let it act as the new caller for a further hop.
    pruneExpired(results, 10 * 60 * 1000);
    const nextRid = randomUUID();
    results.set(nextRid, {
      decoded: { accessToken: step3.decoded },
      rawToken: step3.accessToken,
      rawTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      agentId: pending.targetAgentDashboardId!,
      createdAt: Date.now(),
    });
    res.json({ step3, nextRid });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
