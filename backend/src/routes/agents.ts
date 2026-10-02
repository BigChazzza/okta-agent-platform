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

// GET /api/agents — Okta is the source of truth: only return agents that exist in Okta
router.get('/', async (_req: Request, res: Response) => {
  try {
    const oktaAgents = await okta.listAIAgents(200);
    const oktaIds = new Set(oktaAgents.map(a => a.id));

    // Upsert current Okta agents into local DB
    await Promise.all(oktaAgents.map(upsertAgent));

    // Purge any local DB rows whose Okta agent has been deleted
    const allLocal = await db.select().from(agents);
    const stale = allLocal.filter(a => a.oktaAgentId && !oktaIds.has(a.oktaAgentId));
    await Promise.all(stale.map(async (a) => {
      await db.delete(agentResources).where(eq(agentResources.agentId, a.id));
      await db.delete(agents).where(eq(agents.id, a.id));
    }));

    // Return only agents that exist in Okta, enriched with local metadata
    const withCounts = await Promise.all(
      oktaAgents.map(async (oktaAgent) => {
        // Find or create the local row
        const localRows = await db.select().from(agents).where(eq(agents.oktaAgentId, oktaAgent.id));
        const local = localRows[0];
        const linked = local
          ? await db.select().from(agentResources).where(eq(agentResources.agentId, local.id))
          : [];
        return {
          ...(local || {}),
          oktaAgentId: oktaAgent.id,
          name: oktaAgent.profile.name,
          description: oktaAgent.profile.description || null,
          status: oktaAgent.status.toLowerCase(),
          oktaStatus: oktaAgent.status,
          resourceCount: linked.length,
        };
      })
    );

    // Sort newest first (by Okta created date)
    withCounts.sort((a, b) => {
      const ta = (a as any).createdAt ? new Date((a as any).createdAt).getTime() : 0;
      const tb = (b as any).createdAt ? new Date((b as any).createdAt).getTime() : 0;
      return tb - ta;
    });

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
    let adminConsoleUrl: string | undefined;
    let resourceUrl: string | undefined;
    if (agent.oktaAgentId) {
      try {
        oktaData = await okta.getAIAgent(agent.oktaAgentId);
        if (oktaData?.appId) {
          credentials = await okta.getAgentCredentials(oktaData.appId);
        }
        adminConsoleUrl = await okta.getAgentAdminUrl(agent.oktaAgentId);
      } catch {}
      try { resourceUrl = await okta.getAgentResourceUrl(agent.oktaAgentId); } catch {}
    }

    res.json({
      ...agent,
      resources: linked.map(l => l.resource),
      okta: oktaData,
      credentials,
      adminConsoleUrl,
      userAccessEnabled: !!oktaData?.signOnProvider,
      resourceUrl,
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
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.oktaAgentId) return res.status(400).json({ error: 'Agent has no linked Okta agent' });

    const user = await okta.getUser(userId);

    // 1. Register the owner in Okta's IGA resource-owners registry (source of truth)
    await okta.setAgentOwner(agent.oktaAgentId, userId);

    // 2. Mirror locally for fast display
    const [updated] = await db.update(agents)
      .set({ ownerId: user.id, ownerName: user.displayName, ownerEmail: user.email })
      .where(eq(agents.id, req.params.id)).returning();

    const adminConsoleUrl = await okta.getAgentAdminUrl(agent.oktaAgentId).catch(() => undefined);
    res.json({ ...updated, adminConsoleUrl });
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

// ── Exercise: delegation / Machine Access wiring ─────────────────────────────

// GET /api/agents/:id/authorization-servers — custom authorization servers available for delegation
router.get('/:id/authorization-servers', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.json([]);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const agentOrn = okta.agentOrnFromLinks(oktaAgent._links);
    if (!agentOrn) return res.json([]);
    const servers = await okta.listAuthorizationServers(okta.orgIdFromAgentOrn(agentOrn));
    res.json(servers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/delegations — list agents/apps currently authorized to call this agent
router.get('/:id/delegations', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.json([]);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const targetOrn = okta.agentOrnFromLinks(oktaAgent._links);
    if (!targetOrn) return res.json([]);

    const links = await okta.listDelegationLinksTo(targetOrn);
    const withCallers = await Promise.all(links.map(async (link) => {
      const callerId = link.callerOrn.split(':').pop();
      const isApp = link.callerOrn.includes(':apps:');
      let callerName = callerId;
      try {
        if (isApp) {
          const app = await okta.getApp(callerId!);
          callerName = app.label;
        } else {
          const caller = await okta.getAIAgent(callerId!);
          callerName = caller.profile.name;
        }
      } catch {}
      return { id: link.id, callerAgentId: callerId, callerName, callerType: isApp ? 'app' : 'agent' };
    }));
    res.json(withCallers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/agent-targets — every other agent as a candidate caller/target, flagged
// with whether it already has Machine Access configured (a resourceUrl set in Okta).
router.get('/:id/agent-targets', async (req: Request, res: Response) => {
  try {
    const all = await db.select().from(agents);
    const targets = await Promise.all(
      all.filter(a => a.id !== req.params.id && a.oktaAgentId).map(async (a) => {
        const resourceUrl = await okta.getAgentResourceUrl(a.oktaAgentId!).catch(() => undefined);
        return { id: a.id, oktaAgentId: a.oktaAgentId, name: a.name, machineAccessReady: !!resourceUrl };
      })
    );
    res.json(targets);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/agents/:id/delegations-from — list agents this agent is currently authorized to call
// (the reverse of /delegations — used by the Exercise page's caller-first flow).
router.get('/:id/delegations-from', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent?.oktaAgentId) return res.json([]);
    const oktaAgent = await okta.getAIAgent(agent.oktaAgentId);
    const callerOrn = okta.agentOrnFromLinks(oktaAgent._links);
    if (!callerOrn) return res.json([]);

    const links = await okta.listDelegationLinksFrom(callerOrn);
    const withTargets = await Promise.all(links.map(async (link) => {
      const targetId = link.targetOrn.split(':').pop();
      let targetName = targetId;
      try {
        const target = await okta.getAIAgent(targetId!);
        targetName = target.profile.name;
      } catch {}
      return { id: link.id, targetAgentId: targetId, targetName };
    }));
    res.json(withTargets);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/delegations — authorize another AI agent to call this agent
router.post('/:id/delegations', async (req: Request, res: Response) => {
  const { callerAgentId, authorizationServerId, resourceUrl } = req.body;
  if (!callerAgentId || !authorizationServerId) {
    return res.status(400).json({ error: 'callerAgentId and authorizationServerId are required' });
  }
  try {
    const [target] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!target?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const [caller] = await db.select().from(agents).where(eq(agents.id, callerAgentId));
    if (!caller?.oktaAgentId) return res.status(404).json({ error: 'Calling agent not found' });

    const targetOktaAgent = await okta.getAIAgent(target.oktaAgentId);
    const targetOrn = okta.agentOrnFromLinks(targetOktaAgent._links);
    if (!targetOrn) return res.status(400).json({ error: 'Could not resolve target agent ORN' });

    const callerOktaAgent = await okta.getAIAgent(caller.oktaAgentId);
    const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
    if (!callerOrn) return res.status(400).json({ error: 'Could not resolve calling agent ORN' });

    const orgId = okta.orgIdFromAgentOrn(targetOrn);
    const authServerOrn = okta.buildAuthorizationServerOrn(authorizationServerId, orgId);

    const existingResourceUrl = await okta.getAgentResourceUrl(target.oktaAgentId);
    if (!existingResourceUrl) {
      if (!resourceUrl) return res.status(400).json({ error: 'resourceUrl is required the first time a caller is added to this agent' });
      await okta.setAgentResourceUrl(target.oktaAgentId, resourceUrl);
    }

    await okta.connectAuthorizationServer(target.oktaAgentId, authServerOrn);
    await okta.createDelegationLink(callerOrn, targetOrn, authServerOrn);

    // Also create the reciprocal resource connection — matching the real Okta Admin Console,
    // which keeps a delegation link and its resource connection in sync in both directions.
    let warning: string | undefined;
    try {
      await okta.ensureAgentConnection(caller.oktaAgentId, targetOrn, authServerOrn);
    } catch (e: any) {
      warning = `Caller authorized, but failed to also create the resource connection: ${e.message}`;
    }

    res.status(201).json(warning ? { message: 'Caller authorized', warning } : { message: 'Caller authorized' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/machine-access/assign — streamlined flow: compute the audience URL and
// connect the shared authorization server (EXERCISE_SHARED_AUTH_SERVER_ID) if needed, then
// authorize the caller, in one request.
router.post('/:id/machine-access/assign', async (req: Request, res: Response) => {
  const { callerAgentId } = req.body;
  if (!callerAgentId) return res.status(400).json({ error: 'callerAgentId is required' });
  try {
    const sharedAuthServerId = process.env.EXERCISE_SHARED_AUTH_SERVER_ID;
    if (!sharedAuthServerId) {
      return res.status(400).json({ error: 'EXERCISE_SHARED_AUTH_SERVER_ID is not configured on the backend' });
    }

    const [target] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!target?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });
    const [caller] = await db.select().from(agents).where(eq(agents.id, callerAgentId));
    if (!caller?.oktaAgentId) return res.status(404).json({ error: 'Calling agent not found' });

    const callerOktaAgent = await okta.getAIAgent(caller.oktaAgentId);
    const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
    if (!callerOrn) return res.status(400).json({ error: 'Could not resolve calling agent ORN' });

    const { targetOrn, authServerOrn } = await okta.ensureMachineAccess(target.oktaAgentId, sharedAuthServerId);
    await okta.createDelegationLink(callerOrn, targetOrn, authServerOrn);

    let warning: string | undefined;
    try {
      await okta.ensureAgentConnection(caller.oktaAgentId, targetOrn, authServerOrn);
    } catch (e: any) {
      warning = `Caller authorized, but failed to also create the resource connection: ${e.message}`;
    }

    res.status(201).json(warning ? { message: 'Caller authorized', warning } : { message: 'Caller authorized' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/machine-access/assign-service-client — authorizes the configured service
// client (EXERCISE_SERVICE_CLIENT_ID) as a caller of this agent, the same delegation-links
// mechanism as agent-to-agent Machine Access but with the app's own ORN as from.clientOrn.
router.post('/:id/machine-access/assign-service-client', async (req: Request, res: Response) => {
  try {
    const serviceClientId = process.env.EXERCISE_SERVICE_CLIENT_ID;
    const sharedAuthServerId = process.env.EXERCISE_SHARED_AUTH_SERVER_ID;
    if (!serviceClientId) return res.status(400).json({ error: 'EXERCISE_SERVICE_CLIENT_ID is not configured on the backend' });
    if (!sharedAuthServerId) return res.status(400).json({ error: 'EXERCISE_SHARED_AUTH_SERVER_ID is not configured on the backend' });

    const [target] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!target?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const { targetOrn, authServerOrn } = await okta.ensureMachineAccess(target.oktaAgentId, sharedAuthServerId);
    const orgId = okta.orgIdFromAgentOrn(targetOrn);
    const appOrn = okta.buildAppOrn(serviceClientId, orgId);
    await okta.createDelegationLink(appOrn, targetOrn, authServerOrn);
    res.status(201).json({ message: 'Service client authorized' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agents/:id/machine-access/assign-app — authorize an arbitrary Okta OAuth app as a
// caller of this agent, generalizing assign-service-client to any app the user picks.
router.post('/:id/machine-access/assign-app', async (req: Request, res: Response) => {
  const { appId } = req.body;
  if (!appId) return res.status(400).json({ error: 'appId is required' });
  try {
    const sharedAuthServerId = process.env.EXERCISE_SHARED_AUTH_SERVER_ID;
    if (!sharedAuthServerId) return res.status(400).json({ error: 'EXERCISE_SHARED_AUTH_SERVER_ID is not configured on the backend' });

    const [target] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!target?.oktaAgentId) return res.status(404).json({ error: 'Agent not found' });

    const { targetOrn, authServerOrn } = await okta.ensureMachineAccess(target.oktaAgentId, sharedAuthServerId);
    const orgId = okta.orgIdFromAgentOrn(targetOrn);
    const appOrn = okta.buildAppOrn(appId, orgId);
    await okta.createDelegationLink(appOrn, targetOrn, authServerOrn);
    res.status(201).json({ message: 'App authorized' });
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
