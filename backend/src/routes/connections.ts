import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router();

// GET /api/agents/:id/potential-connections — all types for an agent
router.get('/:id/potential-connections', async (req: Request, res: Response) => {
  try {
    const connections = await okta.listPotentialConnections();
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/potential-connections/:type — single type
router.get('/:id/potential-connections/:type', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as okta.ConnectionType;
    const connections = await okta.listPotentialConnections([type]);
    res.json(connections);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/connections — current Okta connections
router.get('/:id/connections', async (req: Request, res: Response) => {
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
router.post('/:id/connections', async (req: Request, res: Response) => {
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
router.delete('/:id/connections/:connId', async (req: Request, res: Response) => {
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
