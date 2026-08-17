import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router({ mergeParams: true });

// GET /api/agents/:id/potential-connections
router.get('/potential-connections', async (req: Request, res: Response) => {
  try {
    const connections = await okta.listPotentialConnections();
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/connections — list current Okta connections for this agent
router.get('/connections', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.json([]);
    const connections = await okta.listAgentConnections(agent.oktaAgentId);
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/connections — create a connection in Okta
router.post('/connections', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found or not registered in Okta' });

    const connection = await okta.createAgentConnection(agent.oktaAgentId, req.body);
    res.status(201).json(connection);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/agents/:id/connections/:connId
router.delete('/connections/:connId', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    await okta.deleteAgentConnection(agent.oktaAgentId, req.params.connId);
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
