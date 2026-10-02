import dagre from 'dagre';
import type { TokenResult } from '@/components/TokenStepCard';
import type { GraphNode, GraphEdge, GraphNodeData, AgentOption, HopResult, TokenType } from '@/components/graph/graphTypes';

export interface LogHop {
  eventType: string; published: string; outcome: string; reason?: string;
  actorId: string; actorType: string; actorDisplayName?: string;
  issuedTokenId?: string; issuedTokenType?: 'access_token' | 'id_jag' | 'id_token';
  subjectTokenId?: string;
  resourceType?: string; resourceName?: string;
  raw: any;
}
export interface LogInteraction {
  rootTokenId: string; hops: LogHop[]; startedAt: string; actorIds: string[];
}
export interface InteractionGroup {
  shapeKey: string; latest: LogInteraction; occurrences: LogInteraction[];
}

// True when the interaction's first hop consumed an upstream token that was never itself granted
// within the fetched time range — the backend's clusterLogInteractions treats a hop as a root
// whenever its subjectTokenId has no matching grant event in the current fetch, but that's often
// because the real root just happened before the window started (e.g. a 24h-old grant redeemed
// again just now), not because there really was no caller. Used to flag the row so it doesn't
// read as "this agent acted with no caller" when it's really "caller not in view".
export function isTruncatedChain(interaction: LogInteraction): boolean {
  return !!interaction.hops[0]?.subjectTokenId;
}

const RESOURCE_TYPE_MAP: Record<string, 'auth_server' | 'application'> = {
  STATIC_AS_AUDIENCE: 'auth_server',
  A2A_RESOURCE_URL: 'application',
};

function tokenTypeFor(issuedTokenType?: LogHop['issuedTokenType']): TokenType {
  if (issuedTokenType === 'id_jag') return 'JAG';
  if (issuedTokenType === 'id_token') return 'ID';
  return 'AT';
}

// Adapts a historical System Log event into TokenStepCard's live-request-shaped TokenResult —
// there's no `request` half for a past event (Okta doesn't log the outgoing request body), only
// the response side, which TokenStepCard already treats as optional.
function toTokenResult(hop: LogHop): TokenResult {
  return {
    ok: hop.outcome === 'SUCCESS',
    status: hop.outcome === 'SUCCESS' ? 200 : 400,
    raw: { eventType: hop.eventType, outcome: hop.outcome, reason: hop.reason, published: hop.published, debugData: hop.raw.debugContext?.debugData },
  };
}

// A User Access chain's login step (authorization_code grant) is authenticated by the SAME OAuth
// client as the agent's own subsequent token-exchange/redemption — all 3 hops (id_token grant,
// id_jag exchange, access_token redemption) can share one actorId. Grouping purely by actorId
// would incorrectly collapse the login into the agent's own node, losing the User-login origin
// this graph should show for that flow. So login-grant hops (grantType authorization_code) are
// split off into a synthetic Origin node first, and only the REMAINING hops are grouped by
// consecutive actor.
function isLoginGrant(hop: LogHop): boolean {
  return hop.raw?.debugContext?.debugData?.grantType === 'authorization_code';
}

// Groups consecutive hops by actor (an agent doing exchange-then-redeem is two hops, one node)
// into GraphNode/GraphEdge shapes reusing the shared node kinds, and derives the TokenIcons chips
// each node should show.
export function buildLogGraph(interaction: LogInteraction, agents: AgentOption[]): {
  nodes: GraphNode[]; edges: GraphEdge[];
  hopsByNodeId: Map<string, HopResult[]>; incomingByNodeId: Record<string, HopResult>;
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const hopsByNodeId = new Map<string, HopResult[]>();
  const incomingByNodeId: Record<string, HopResult> = {};

  const allHops = interaction.hops;
  let splitIndex = 0;
  while (splitIndex < allHops.length && isLoginGrant(allHops[splitIndex])) splitIndex++;
  const loginHops = allHops.slice(0, splitIndex);
  // Only split off a synthetic Origin node when the login actually led to something further —
  // a standalone login grant with nothing downstream (e.g. the access_token sibling event Okta
  // logs alongside an id_token grant, never itself exchanged) renders as a plain node instead,
  // since there's nothing to show it originating INTO.
  const remainingHops = loginHops.length < allHops.length ? allHops.slice(splitIndex) : allHops;
  const originHops = loginHops.length < allHops.length ? loginHops : [];

  let originNodeId: string | undefined;
  if (originHops.length > 0) {
    originNodeId = 'log-origin';
    // The login grant's actor IS the agent's own OAuth client, so its actorDisplayName is the
    // actual app/agent name the user logged into — more useful here than a generic "User login"
    // label, since OriginNode.tsx's own "Start here" sub-title already conveys what kind of node
    // this is.
    const appName = originHops[0].actorDisplayName || 'User login';
    nodes.push({ id: originNodeId, data: { kind: 'origin', originKind: 'user', agentDashboardId: '', label: appName, supertitle: 'User login' } });
    hopsByNodeId.set(originNodeId, originHops.map((h) => ({ label: h.eventType, result: toTokenResult(h), tokenType: tokenTypeFor(h.issuedTokenType) })));
  }

  // Collapse consecutive same-actor hops into one node.
  const groups: { actorId: string; actorType: string; actorDisplayName?: string; hops: LogHop[] }[] = [];
  for (const hop of remainingHops) {
    const last = groups[groups.length - 1];
    if (last && last.actorId === hop.actorId) last.hops.push(hop);
    else groups.push({ actorId: hop.actorId, actorType: hop.actorType, actorDisplayName: hop.actorDisplayName, hops: [hop] });
  }

  const nodeIds = groups.map((g, i) => `log-actor:${i}:${g.actorId}`);

  groups.forEach((g, i) => {
    const nodeId = nodeIds[i];
    const knownAgent = agents.find((a) => a.oktaAgentId === g.actorId);
    let data: GraphNodeData;
    if (g.actorType === 'User') {
      data = { kind: 'origin', originKind: 'user', agentDashboardId: '', label: g.actorDisplayName || 'User' };
    } else if (knownAgent) {
      data = { kind: 'agent', dashboardId: knownAgent.id, oktaAgentId: g.actorId, name: knownAgent.name };
    } else {
      data = { kind: 'app', oktaAppId: g.actorId, name: g.actorDisplayName || g.actorId };
    }
    nodes.push({ id: nodeId, data });

    const hopResults: HopResult[] = g.hops.map((h) => ({
      label: h.eventType, result: toTokenResult(h), tokenType: tokenTypeFor(h.issuedTokenType),
    }));
    hopsByNodeId.set(nodeId, hopResults);

    const prevNodeId = i > 0 ? nodeIds[i - 1] : originNodeId;
    if (prevNodeId) {
      // Incoming is what the PREVIOUS node handed to this one (its own last issued token — an AT
      // from a grant, or an ID from a login) — not this node's own first outgoing hop.
      const prevHops = hopsByNodeId.get(prevNodeId);
      if (prevHops?.length) incomingByNodeId[nodeId] = prevHops[prevHops.length - 1];
      edges.push({ id: `e:${prevNodeId}->${nodeId}`, source: prevNodeId, target: nodeId });
    }
  });

  // A terminal resource — the last hop that actually names one (a redemption against a Custom AS
  // or A2A target) — becomes a trailing leaf node, distinct from the actor chain above (the
  // resource being accessed isn't itself a caller). resourceType is frequently absent even when
  // resourceName IS present (most TRANSACTION_API redemptions carry no debugData.resourceType at
  // all) — requiring both would silently drop the resource node in the common case. Falls back to
  // the issued access token's own `audience` (the resource being granted, specifically on the
  // terminal hop) when resourceName itself is also missing.
  const lastHop = interaction.hops[interaction.hops.length - 1];
  const lastHopAudience = lastHop?.raw?.target?.find((t: any) => t.type === 'access_token')?.detailEntry?.audience;
  const terminalResourceName = lastHop?.resourceName || lastHopAudience;
  if (terminalResourceName && nodeIds.length > 0) {
    const resourceNodeId = `log-resource:${nodeIds.length}`;
    const resourceTypeId = lastHop.resourceType ? (RESOURCE_TYPE_MAP[lastHop.resourceType] || 'auth_server') : 'auth_server';
    nodes.push({ id: resourceNodeId, data: { kind: 'resource', connectionId: resourceNodeId, name: terminalResourceName, resourceTypeId } });
    edges.push({ id: `e:${nodeIds[nodeIds.length - 1]}->${resourceNodeId}`, source: nodeIds[nodeIds.length - 1], target: resourceNodeId });
    incomingByNodeId[resourceNodeId] = { label: lastHop.eventType, result: toTokenResult(lastHop), tokenType: tokenTypeFor(lastHop.issuedTokenType) };
  }

  return { nodes, edges, hopsByNodeId, incomingByNodeId };
}

// Ordered display labels for a row's summary line (e.g. "User login → CHAT_AGENT →
// TRANSACTION_API") — reads straight off the nodes buildLogGraph already produced, in the same
// order they were pushed (origin, then each agent/app hop, then the terminal resource).
export function chainLabels(nodes: GraphNode[]): string[] {
  return nodes.map((n) => {
    if (n.data.kind === 'origin') return 'User login';
    if (n.data.kind === 'resource') return n.data.name;
    if (n.data.kind === 'agent') return n.data.name;
    return n.data.name;
  });
}

const NODE_WIDTH = 224;
const NODE_HEIGHT = 56;

interface LayoutedNode { id: string; type: string; position: { x: number; y: number }; data: GraphNodeData; }

// Dagre wrapper shared with Exercise/Chat's own graph layout once those are ported.
export function layoutLogGraph(nodes: GraphNode[], edges: GraphEdge[]): LayoutedNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, type: n.data.kind, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }, data: n.data };
  });
}
