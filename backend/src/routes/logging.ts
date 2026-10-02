import { Router, Request, Response } from 'express';
import * as okta from '../services/okta';

const router = Router();

// Two interactions are "the same shape" when every hop matches on actor, event type, AND outcome,
// in order — a chain that fails partway through naturally has fewer/different hops than its usual
// successful run, so it lands in its own group automatically, no special-casing needed.
function shapeKey(interaction: okta.LogInteraction): string {
  return interaction.hops.map((h) => `${h.actorId}|${h.eventType}|${h.outcome}`).join('>');
}

interface InteractionGroup {
  shapeKey: string;
  latest: okta.LogInteraction;
  occurrences: okta.LogInteraction[];
}

// Groups near-duplicate interactions (same agents, same event types, same outcomes — differing
// only by underlying token ids) into one row, so a chain that runs repeatedly in a short burst
// shows as one row with a count, not dozens of identical-looking rows.
function groupByShape(interactions: okta.LogInteraction[]): InteractionGroup[] {
  const groups = new Map<string, okta.LogInteraction[]>();
  for (const i of interactions) {
    const key = shapeKey(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => {
      group.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return { shapeKey: key, latest: group[0], occurrences: group };
    })
    .sort((a, b) => b.latest.startedAt.localeCompare(a.latest.startedAt));
}

// GET /api/logging/interactions?hours=1&actorId=...&agentId=...&resourceType=...&resourceName=...
// Org-wide, time-range-bound on the Okta side; Caller/Agent/Resource filters are applied
// afterward against the same clustered result set, not as separate Okta queries.
router.get('/interactions', async (req: Request, res: Response) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 1, 24 * 7);
    const until = new Date();
    const since = new Date(until.getTime() - hours * 60 * 60 * 1000);
    const [events, aiAgents] = await Promise.all([
      okta.getOAuthSystemLogs(since.toISOString(), until.toISOString()),
      okta.listAIAgents(200),
    ]);
    // eventType sw "app.oauth2." catches every OAuth2 client org-wide, not just AI agents — Okta's
    // own internal services (Privileged Access Connector, Admin Console, etc.) show up the same
    // way. Drop any interaction that never actually involves a real registered AI agent.
    const agentIds = new Set(aiAgents.map((a) => a.id));
    const allInteractions = okta.clusterLogInteractions(events).filter((i) => i.hops.some((h) => agentIds.has(h.actorId)));

    const { actorId, agentId, resourceType, resourceName } = req.query as Record<string, string | undefined>;
    let interactions = allInteractions;
    if (actorId) interactions = interactions.filter((i) => i.actorIds.has(actorId));
    if (agentId) interactions = interactions.filter((i) => i.actorIds.has(agentId));
    if (resourceType) interactions = interactions.filter((i) => i.hops.some((h) => h.resourceType === resourceType));
    if (resourceName) interactions = interactions.filter((i) => i.hops.some((h) => h.resourceName === resourceName));

    // Dropdown options always reflect the full (unfiltered by the above) time range, so a filter
    // can never be set to a value with zero possible matches, regardless of the other filters.
    const actors = new Map<string, { id: string; type: string; displayName?: string }>();
    const resourcesSeen = new Map<string, { type: string; name: string }>();
    for (const i of allInteractions) {
      for (const h of i.hops) {
        actors.set(h.actorId, { id: h.actorId, type: h.actorType, displayName: h.actorDisplayName });
        if (h.resourceType && h.resourceName) resourcesSeen.set(`${h.resourceType}:${h.resourceName}`, { type: h.resourceType, name: h.resourceName });
      }
    }

    const serialize = (i: okta.LogInteraction) => ({ ...i, actorIds: Array.from(i.actorIds) });
    const groups = groupByShape(interactions);

    res.json({
      interactionGroups: groups.map((g) => ({
        shapeKey: g.shapeKey,
        latest: serialize(g.latest),
        occurrences: g.occurrences.map(serialize),
      })),
      filterOptions: { actors: Array.from(actors.values()), resources: Array.from(resourcesSeen.values()) },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
