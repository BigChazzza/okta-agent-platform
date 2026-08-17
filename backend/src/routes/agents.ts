import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { agents, agentResources, resources } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router();

// GET /api/agents — list all agents (merged DB + Okta)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const allAgents = await db.select().from(agents).orderBy(agents.createdAt);
    const withCounts = await Promise.all(
      allAgents.map(async (agent) => {
        const linked = await db.select().from(agentResources).where(eq(agentResources.agentId, agent.id));
        return { ...agent, resourceCount: linked.length };
      })
    );
    res.json(withCounts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents — create agent in Okta AI Agents API + store in DB
router.post('/', async (req: Request, res: Response) => {
  const { name, description } = req.body;
  const createdBy = req.headers['x-user-id'] as string | undefined;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    // Register with Okta AI Agents API
    const oktaAgent = await okta.createAIAgent(name, description);

    const [agent] = await db
      .insert(agents)
      .values({
        name,
        description: description || null,
        oktaAgentId: oktaAgent.id,
        status: oktaAgent.status === 'ACTIVE' ? 'active' : 'staged',
        createdBy: createdBy || null,
      })
      .returning();

    res.status(201).json({ ...agent, oktaStatus: oktaAgent.status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const linked = await db
      .select({ resource: resources })
      .from(agentResources)
      .innerJoin(resources, eq(agentResources.resourceId, resources.id))
      .where(eq(agentResources.agentId, agent.id));

    // Enrich with live Okta data if available
    let oktaData: okta.OktaAIAgent | null = null;
    if (agent.oktaAgentId) {
      try { oktaData = await okta.getAIAgent(agent.oktaAgentId); } catch {}
    }

    res.json({
      ...agent,
      resources: linked.map((l) => l.resource),
      okta: oktaData ? { status: oktaData.status, platform: oktaData.platform, profile: oktaData.profile } : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/agents/:id/owner
router.put('/:id/owner', async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  try {
    const user = await okta.getUser(userId);
    const [updated] = await db
      .update(agents)
      .set({ ownerId: user.id, ownerName: user.displayName, ownerEmail: user.email })
      .where(eq(agents.id, req.params.id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Agent not found' });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/agents/:id/resources
router.put('/:id/resources', async (req: Request, res: Response) => {
  const { resourceIds } = req.body as { resourceIds: string[] };
  if (!Array.isArray(resourceIds)) return res.status(400).json({ error: 'resourceIds array required' });
  try {
    await db.delete(agentResources).where(eq(agentResources.agentId, req.params.id));
    if (resourceIds.length > 0) {
      await db.insert(agentResources).values(
        resourceIds.map((rid) => ({ agentId: req.params.id, resourceId: rid }))
      );
    }
    const linked = await db
      .select({ resource: resources })
      .from(agentResources)
      .innerJoin(resources, eq(agentResources.resourceId, resources.id))
      .where(eq(agentResources.agentId, req.params.id));
    res.json({ resourceIds, resources: linked.map((l) => l.resource) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.oktaAgentId) {
      await okta.deleteAIAgent(agent.oktaAgentId).catch(() => {});
    }
    await db.delete(agentResources).where(eq(agentResources.agentId, req.params.id));
    await db.delete(agents).where(eq(agents.id, req.params.id));
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
