import { Router, Request, Response } from 'express';
import { db } from '../db/client';
import { agents, agentResources } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as okta from '../services/okta';
import { eventBus, nextId, AgentRequestMilestoneEvent } from '../services/eventBus';

const router = Router();

// Visible marker on the agent's actual Okta name — survives backend restarts and is what
// /reset actually matches against (a local DB flag would be lost if the DB were ever wiped and
// the agent silently re-upserted from Okta with no way to know it was wizard-created).
const AGENT_REQUEST_PREFIX = `[${process.env.PORTAL_NAME || 'Agent Request'}] `;

function emitMilestone(label: string, detail?: string) {
  const evt: AgentRequestMilestoneEvent = { id: nextId(), ts: new Date().toISOString(), label, status: 'done', detail };
  eventBus.emit('agent-request:milestone', evt);
}

function emitError(label: string, error: string) {
  const evt: AgentRequestMilestoneEvent = { id: nextId(), ts: new Date().toISOString(), label, status: 'error', error };
  eventBus.emit('agent-request:milestone', evt);
}

// Resolve the shared authorization server for Machine Access from the same env var Exercise's
// streamlined Machine Access flow already uses (EXERCISE_SHARED_AUTH_SERVER_ID), self-healing to
// the org's 'default' authorization server if it was never configured — picks the first
// available one rather than hard-failing like a stricter admin-console flow would.
async function resolveSharedAuthorizationServer(): Promise<string> {
  const configured = process.env.EXERCISE_SHARED_AUTH_SERVER_ID;
  if (configured) return configured;

  const orgId = await okta.getAnyOrgId();
  if (!orgId) throw new Error('Could not resolve an org ID to look up authorization servers');
  const servers = await okta.listAuthorizationServers(orgId);
  if (servers.length === 0) throw new Error('No authorization servers available in this org');
  return (servers.find((s) => s.name === 'default') || servers[0]).id;
}

// POST /api/agent-requests/onboard — one-shot wizard submission: create agent, assign owner,
// configure access pattern(s), issue credentials, connect resources. Emits a named milestone on
// the eventBus after each logical step so the frontend can render a progressive reveal instead
// of one long silent wait.
router.post('/onboard', async (req: Request, res: Response) => {
  const {
    name, description,
    ownerId, ownerName, ownerEmail,
    userAccess, signInUsers, signInGroups,
    machineAccess, machineCallerAgentIds,
    credentialType,
    connections,
  } = req.body as {
    name: string; description?: string;
    ownerId: string; ownerName: string; ownerEmail: string;
    userAccess: boolean;
    signInUsers?: { id: string; displayName: string }[];
    signInGroups?: { id: string; name: string }[];
    machineAccess: boolean; machineCallerAgentIds?: string[]; // local agent IDs of existing agents
    credentialType: 'private_key_jwt' | 'client_secret_basic';
    // Full potential-connection objects the user picked, as returned by GET /api/resources —
    // sent as-is rather than re-resolved by ORN, since several distinct connections (e.g. an
    // Authorization Server entry and an unrelated Agent-to-Agent entry) can share the same
    // authorization server ORN, making ORN alone ambiguous for matching back the right one.
    connections?: okta.PotentialConnection[];
  };

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });

  let localAgentId: string | undefined;
  let oktaAgentId: string | undefined;

  try {
    // 1. Create the agent identity. The visible [Agent Request] prefix on the real Okta name is
    // the durable marker /reset matches on.
    const oktaAgent = await okta.createAIAgent(AGENT_REQUEST_PREFIX + name.trim(), description?.trim());
    oktaAgentId = oktaAgent.id;
    const [local] = await db.insert(agents).values({
      name: oktaAgent.profile.name,
      description: oktaAgent.profile.description || null,
      oktaAgentId: oktaAgent.id,
      status: oktaAgent.status?.toLowerCase() || 'staged',
      createdBy: ownerId,
    }).returning();
    localAgentId = local.id;
    emitMilestone('Agent identity created', name.trim());
  } catch (e: any) {
    emitError('Agent identity created', e.message);
    return res.status(500).json({ error: e.message });
  }

  try {
    // 2. Assign owner
    await okta.setAgentOwner(oktaAgentId, ownerId);
    await db.update(agents).set({ ownerId, ownerName, ownerEmail }).where(eq(agents.id, localAgentId));
    emitMilestone('Owner assigned', ownerName);
  } catch (e: any) {
    emitError('Owner assigned', e.message);
    return res.status(500).json({ error: e.message, agentId: localAgentId });
  }

  let backingAppId: string | undefined;

  try {
    // 3. User Access (human sign-in) — assign every selected sign-in user/group, defaulting
    // to just the owner if nothing was explicitly picked
    if (userAccess) {
      backingAppId = await okta.ensureUserAccess(oktaAgentId);
      const users = signInUsers && signInUsers.length > 0 ? signInUsers : [{ id: ownerId, displayName: ownerName }];
      const groups = signInGroups || [];
      for (const u of users) {
        await okta.assignUserToApp(backingAppId, u.id);
      }
      for (const g of groups) {
        await okta.assignGroupToApp(backingAppId, g.id);
      }
      const names = [...users.map((u) => u.displayName), ...groups.map((g) => `${g.name} (group)`)];
      emitMilestone('Human sign-in enabled', names.join(', '));
    }
  } catch (e: any) {
    emitError('Human sign-in enabled', e.message);
    return res.status(500).json({ error: e.message, agentId: localAgentId });
  }

  try {
    // 4. Machine Access (agent-to-agent delegation) — connect the shared authorization
    // server, then authorize each selected caller agent to actually call this one.
    if (machineAccess) {
      const authServerId = await resolveSharedAuthorizationServer();
      const { targetOrn, authServerOrn } = await okta.ensureMachineAccess(oktaAgentId, authServerId);

      const callerNames: string[] = [];
      for (const callerLocalId of machineCallerAgentIds || []) {
        const [caller] = await db.select().from(agents).where(eq(agents.id, callerLocalId));
        if (!caller?.oktaAgentId) continue;
        const callerOktaAgent = await okta.getAIAgent(caller.oktaAgentId);
        const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
        if (!callerOrn) continue;
        await okta.createDelegationLink(callerOrn, targetOrn, authServerOrn);
        callerNames.push(caller.name);
      }
      emitMilestone(
        'Machine access configured',
        callerNames.length > 0 ? `Callers authorized: ${callerNames.join(', ')}` : 'Ready for delegation'
      );
    }
  } catch (e: any) {
    emitError('Machine access configured', e.message);
    return res.status(500).json({ error: e.message, agentId: localAgentId });
  }

  try {
    // 5. Credentials — depends on whether a backing app exists (User Access above).
    // private_key_jwt on a backing app requires manually uploading a public key in the Okta
    // Admin Console (setAgentAuthMethod only flips the auth method flag, it doesn't provision key
    // material) — not automatable, so backing-app agents get a real, auto-provisioned client
    // secret instead. Only native agents (no backing app) can honor a private_key_jwt request,
    // since createAgentJwk generates and registers a real keypair server-side with no manual step.
    // Okta only ever returns a freshly-minted secret/key once, on the response that creates it —
    // persisting it here is the ONLY way it survives past this request. Without this, every
    // caller that later needs this agent's credential (Chat's ensureCallerCredential, Exercise's
    // resolveCallerCred) finds nothing locally and mints ANOTHER fresh secret on every use,
    // eventually hitting Okta's per-client secret cap.
    let issuedNote: string;
    if (backingAppId) {
      const result = await okta.setAgentAuthMethod(backingAppId, 'client_secret_basic');
      if (result.clientSecret) await db.update(agents).set({ testClientSecret: result.clientSecret }).where(eq(agents.id, localAgentId));
      issuedNote = 'Client secret issued';
    } else if (credentialType === 'private_key_jwt') {
      const { kid, privateKeyPem } = await okta.createAgentJwk(oktaAgentId);
      await db.update(agents).set({ testPrivateKeyPem: privateKeyPem, testPrivateKeyKid: kid }).where(eq(agents.id, localAgentId));
      issuedNote = 'No shared secret transmitted';
    } else {
      const { clientSecret } = await okta.createAgentSecret(oktaAgentId);
      await db.update(agents).set({ testClientSecret: clientSecret }).where(eq(agents.id, localAgentId));
      issuedNote = 'Client secret issued';
    }
    emitMilestone('Credentials issued', issuedNote);
  } catch (e: any) {
    emitError('Credentials issued', e.message);
    return res.status(500).json({ error: e.message, agentId: localAgentId });
  }

  try {
    // 6. Resource connections — use the exact connection objects the client selected (returned
    // verbatim from GET /api/resources), not a re-resolution by ORN. Several distinct potential
    // connections can share the same authorization server ORN, so matching by ORN alone can
    // silently grab the wrong one.
    for (const connection of connections || []) {
      const created = await okta.createAgentConnection(oktaAgentId, connection);

      // An A2A connection only authorizes this NEW agent's own side (as a caller) — Okta also
      // requires a reciprocal delegation link on the TARGET agent's side before the target will
      // actually accept a call from this one. connections.ts's admin-dashboard POST /connections
      // route already does this same reciprocal step for the exact same connection type.
      if (created.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER' && created.resource?.orn && created.authorizationServer?.orn) {
        try {
          const callerOktaAgent = await okta.getAIAgent(oktaAgentId);
          const callerOrn = okta.agentOrnFromLinks(callerOktaAgent._links);
          const targetAgentId = created.resource.orn.split(':').pop();
          const targetOktaAgent = targetAgentId ? await okta.getAIAgent(targetAgentId) : null;
          const targetOrn = targetOktaAgent ? okta.agentOrnFromLinks(targetOktaAgent._links) : '';
          if (callerOrn && targetOrn) {
            await okta.createDelegationLink(callerOrn, targetOrn, created.authorizationServer.orn);
          }
        } catch (e: any) {
          emitError('Connected to resource', `Connection created, but failed to also authorize this as a Machine Access caller: ${e.message}`);
        }
      }

      // For A2A connections, the target agent's own name (resource.name) is the meaningful
      // label — the shared authorizationServer.name (e.g. "ProGear Pricing API") would be
      // misleading here, since several distinct A2A targets can front the same auth server.
      const resourceName = connection.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER'
        ? connection.resource?.name || connection.connectionType
        : connection.authorizationServer?.name || connection.resource?.appInstanceName || connection.resource?.clientAuthSettings?.name || connection.connectionType;
      emitMilestone('Connected to resource', resourceName);
    }
  } catch (e: any) {
    emitError('Connected to resource', e.message);
    return res.status(500).json({ error: e.message, agentId: localAgentId });
  }

  // 7. Activate — a newly created agent starts STAGED. The User Access path happens to leave it
  // ACTIVE as a side effect of provisioning the backing app, but a Machine-Access-only agent (no
  // backing app) has no such side effect and stays STAGED forever unless explicitly activated.
  try {
    const activated = await okta.activateAIAgent(oktaAgentId);
    await db.update(agents).set({ status: (activated.status || 'active').toLowerCase() }).where(eq(agents.id, localAgentId));
  } catch (e: any) {
    emitError('Agent live in Okta\'s AI Agent directory', `Provisioning finished, but activation failed: ${e.message}`);
    return res.status(500).json({ error: e.message, agentId: localAgentId });
  }

  // 8. Final — agent is fully live
  try {
    const adminConsoleUrl = await okta.getAgentAdminUrl(oktaAgentId);
    emitMilestone('Agent live in Okta\'s AI Agent directory', name.trim());
    res.status(201).json({ agentId: localAgentId, oktaAgentId, adminConsoleUrl });
  } catch (e: any) {
    // Non-fatal — the agent is already fully provisioned, just couldn't build the admin URL
    emitMilestone('Agent live in Okta\'s AI Agent directory', name.trim());
    res.status(201).json({ agentId: localAgentId, oktaAgentId });
  }
});

// GET /api/agent-requests/events — SSE stream of translated onboarding milestones (separate from
// the raw Okta API log at /api/events, so the two feeds stay independent)
router.get('/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
    'Access-Control-Allow-Credentials': 'true',
  });
  res.write('data: {"type":"connected"}\n\n');

  const handler = (event: AgentRequestMilestoneEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  eventBus.on('agent-request:milestone', handler);

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(ping);
    eventBus.off('agent-request:milestone', handler);
  });
});

// Deactivation can be an async 202 that hasn't propagated yet — Okta rejects delete on anything
// but INACTIVE/STAGED, so retry the delete briefly rather than assuming deactivate completed
// synchronously.
async function deactivateThenDelete(oktaAgentId: string): Promise<void> {
  await okta.deactivateAIAgent(oktaAgentId).catch(() => {});
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await okta.deleteAIAgent(oktaAgentId);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// POST /api/agent-requests/reset — delete every agent created by the agent request wizard, both
// in Okta and locally, so rehearsals don't accumulate clutter. Matches against Okta's live agent
// list by the [Agent Request] name prefix (durable — survives a backend restart).
router.post('/reset', async (_req: Request, res: Response) => {
  try {
    const oktaAgents = await okta.listAIAgents(200);
    const agentRequestAgents = oktaAgents.filter((a) => a.profile.name.startsWith(AGENT_REQUEST_PREFIX));

    const allLocal = await db.select().from(agents);
    for (const oktaAgent of agentRequestAgents) {
      await deactivateThenDelete(oktaAgent.id);
      const local = allLocal.find((a) => a.oktaAgentId === oktaAgent.id);
      if (local) {
        await db.delete(agentResources).where(eq(agentResources.agentId, local.id));
        await db.delete(agents).where(eq(agents.id, local.id));
      }
    }
    res.json({ deleted: agentRequestAgents.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
