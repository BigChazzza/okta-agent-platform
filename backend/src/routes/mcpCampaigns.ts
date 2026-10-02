import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createCampaignsMcpServer } from '../services/campaignsMcp';

// Embedded MCP server for marketing campaigns, mounted in the same Express process (no separate
// deployable service) — called only by this backend's own chat route as the XAA-redeemed caller,
// never directly by a browser, so a plain per-session bearer-token/issuer map (captured from
// request headers at session-init time) is enough.
const router = Router();

const transports = new Map<string, StreamableHTTPServerTransport>();

router.post('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  const body = req.body;
  const messages = Array.isArray(body) ? body : [body];
  const isInitializeRequest = messages.some((msg) => msg?.method === 'initialize');
  if (sessionId && !isInitializeRequest) {
    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
    return;
  }

  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const issuer = req.headers['x-campaigns-issuer'] as string | undefined;
  if (!bearerToken || !issuer) {
    res.status(400).json({ error: 'Missing Authorization bearer token or x-campaigns-issuer header' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  const mcpServer = createCampaignsMcpServer(bearerToken, issuer);

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) transports.delete(sid);
  };

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
  if (transport.sessionId) transports.set(transport.sessionId, transport);
});

router.get('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res);
    return;
  }
  res.status(400).json({ error: 'No session. Send a POST first.' });
});

router.delete('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
    return;
  }
  res.status(400).json({ error: 'No session found.' });
});

export default router;
