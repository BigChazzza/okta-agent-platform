import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { agents, agentResources, resources } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';

const router = Router();

// ── Sync helper: upsert an Okta agent into local DB ──────────────────────────
async function upsertAgent(oktaAgent: okta.OktaAIAgent) {
  const existing = await db.select().from(agents)
    .where(eq(agents.oktaAgentId, oktaAgent.id));
  if (existing.length) {
    await db.update(agents)
      .set({ name: oktaAgent.profile.name, description: oktaAgent.profile.description || null, status: oktaAgent.status.toLowerCase() })
      .where(eq(agents.oktaAgentId, oktaAgent.id));
    return existing[0];
  }
  const [a] = await db.insert(agents).values({
    name: oktaAgent.profile.name,
    description: oktaAgent.profile.description || null,
    oktaAgentId: oktaAgent.id,
    status: oktaAgent.status.toLowerCase(),
  }).returning();
  return a;
}

// GET /api/agents — sync ALL agents from Okta, return merged with DB metadata
router.get('/', async (_req: Request, res: Response) => {
  try {
    const oktaAgents = await okta.listAIAgents(200);
    // Upsert all Okta agents to local DB
    await Promise.all(oktaAgents.map(upsertAgent));
    // Return full list with DB metadata (owner, resource count)
    const allAgents = await db.select().from(agents).orderBy(agents.createdAt);
    const withCounts = await Promise.all(
      allAgents.map(async (agent) => {
        const linked = await db.select().from(agentResources).where(eq(agentResources.agentId, agent.id));
        const oktaData = oktaAgents.find(a => a.id === agent.oktaAgentId);
        return { ...agent, resourceCount: linked.length, oktaStatus: oktaData?.status };
      })
    );
    res.json(withCounts);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents — create in Okta, store in DB
router.post('/', async (req: Request, res: Response) => {
  const { name, description } = req.body;
  const createdBy = req.headers['x-user-id'] as string | undefined;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const oktaAgent = await okta.createAIAgent(name.trim(), description?.trim());
    const [agent] = await db.insert(agents).values({
      name: oktaAgent.profile.name, description: oktaAgent.profile.description || null,
      oktaAgentId: oktaAgent.id, status: oktaAgent.status?.toLowerCase() || 'staged',
      createdBy: createdBy || null,
    }).returning();
    res.status(201).json({ ...agent, oktaStatus: oktaAgent.status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id — full agent detail with live Okta data
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const linked = await db.select({ resource: resources })
      .from(agentResources).innerJoin(resources, eq(agentResources.resourceId, resources.id))
      .where(eq(agentResources.agentId, agent.id));

    let oktaData: any = null;
    let credentials: any = null;
    if (agent.oktaAgentId) {
      try {
        oktaData = await okta.getAIAgent(agent.oktaAgentId);
        // If active and has appId, get credential config
        if (oktaData?.appId) {
          credentials = await okta.getAgentCredentials(oktaData.appId);
        }
      } catch {}
    }

    res.json({
      ...agent,
      resources: linked.map(l => l.resource),
      okta: oktaData,
      credentials,
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
    const [updated] = await db.update(agents)
      .set({ ownerId: user.id, ownerName: user.displayName, ownerEmail: user.email })
      .where(eq(agents.id, req.params.id)).returning();
    if (!updated) return res.status(404).json({ error: 'Agent not found' });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/activate
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const result = await okta.activateAIAgent(agent.oktaAgentId);
    // Update local DB status
    await db.update(agents).set({ status: 'active' }).where(eq(agents.id, req.params.id));
    res.json({ message: 'Activation triggered', ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/deactivate
router.post('/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    await okta.deactivateAIAgent(agent.oktaAgentId);
    await db.update(agents).set({ status: 'inactive' }).where(eq(agents.id, req.params.id));
    res.json({ message: 'Deactivated' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/agents/:id/credentials — set auth method on backing app
router.put('/:id/credentials', async (req: Request, res: Response) => {
  const { authMethod } = req.body; // 'none' | 'client_secret_basic' | 'private_key_jwt'
  if (!authMethod) return res.status(400).json({ error: 'authMethod is required' });
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    if (!oktaAgent.appId) return res.status(400).json({ error: 'Agent must be activated before configuring credentials' });
    const result = await okta.setAgentAuthMethod(oktaAgent.appId, authMethod);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.oktaAgentId) await okta.deleteAIAgent(agent.oktaAgentId).catch(() => {});
    await db.delete(agentResources).where(eq(agentResources.agentId, req.params.id));
    await db.delete(agents).where(eq(agents.id, req.params.id));
    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
