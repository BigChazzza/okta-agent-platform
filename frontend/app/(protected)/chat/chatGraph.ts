import dagre from 'dagre';
import type { TokenResult } from '@/components/TokenStepCard';
import type { HopResult } from '../exercise/graph/usePathRunner';
import type { GraphNode, GraphEdge, GraphNodeData } from '../exercise/graph/graphData';

// Chat's token flow is always a straight line — User Login -> agent -> agent -> ... ->
// Campaigns authorization server — driven by however many hops the backend's BFS
// (resolveCampaignsAccessPath) actually resolved, not an explorable topology like Exercise's
// fetchNeighbors graph. So this builds the fixed shape directly from the trace instead of
// fetching/expanding anything.

// redemption is absent when the exchange itself failed — that hop never got far enough to redeem
// anything, but it's still recorded so the graph can show a red error chip on the exact hop that
// failed instead of the whole trace disappearing.
export interface ChatHopTrace { agentId: string; agentName: string; exchange: TokenResult; redemption?: TokenResult; }
export interface ChatAgentChainEntry { agentId: string; agentName: string; }

const ORIGIN_NODE_ID = 'chat-origin';
const RESOURCE_NODE_ID = 'chat-resource';
function agentNodeId(agentId: string, index: number) {
  // index disambiguates a chain that happens to revisit the same dashboard agent id twice,
  // though resolveCampaignsAccessPath's own visited-set already rules that out server-side.
  return `chat-agent:${index}:${agentId}`;
}

const NODE_WIDTH = 224;
const NODE_HEIGHT = 56;
const AUTH_SERVER_NODE_HEIGHT = 90;

function nodeHeight(n: GraphNode): number {
  return n.data.kind === 'resource' && n.data.resourceTypeId === 'auth_server' ? AUTH_SERVER_NODE_HEIGHT : NODE_HEIGHT;
}

interface LayoutedNode { id: string; type: string; position: { x: number; y: number }; data: GraphNodeData; }

// Same small dagre wrapper ExerciseGraph.tsx's layout() uses — reused inline here since the
// topology is a straight line either way, just consistent spacing/handle positions.
export function layoutChatGraph(nodes: GraphNode[], edges: GraphEdge[]): LayoutedNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: nodeHeight(n) });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, type: n.data.kind, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - nodeHeight(n) / 2 }, data: n.data };
  });
}

// Builds the fixed node/edge shape for the agent chain — either the backend's own resolved chain
// (fetched via GET /:agentId/access-path as soon as an agent is selected, well before any login),
// or the same shape derived from a real tokenTrace's hops once one exists. Building from the
// chain rather than from hops means the graph shows every node immediately, the same way
// Exercise's fetchNeighbors populates its graph up front instead of only after a click.
export function buildChatGraph(agentChain: ChatAgentChainEntry[], resourceName: string, resourceSub?: string): { nodes: GraphNode[]; edges: GraphEdge[]; agentNodeIds: string[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({ id: ORIGIN_NODE_ID, data: { kind: 'origin', originKind: 'user', agentDashboardId: '', label: 'User login' } });

  const agentIds = agentChain.map((h, i) => agentNodeId(h.agentId, i));
  agentChain.forEach((h, i) => {
    nodes.push({ id: agentIds[i], data: { kind: 'agent', dashboardId: h.agentId, name: h.agentName } });
  });

  nodes.push({
    id: RESOURCE_NODE_ID,
    data: { kind: 'resource', connectionId: RESOURCE_NODE_ID, name: resourceName, resourceTypeId: 'auth_server', sub: resourceSub },
  });

  if (agentIds.length > 0) {
    edges.push({ id: `e:${ORIGIN_NODE_ID}->${agentIds[0]}`, source: ORIGIN_NODE_ID, target: agentIds[0], label: 'User' });
    for (let i = 0; i < agentIds.length - 1; i++) {
      edges.push({ id: `e:${agentIds[i]}->${agentIds[i + 1]}`, source: agentIds[i], target: agentIds[i + 1], label: 'A2A' });
    }
    edges.push({ id: `e:${agentIds[agentIds.length - 1]}->${RESOURCE_NODE_ID}`, source: agentIds[agentIds.length - 1], target: RESOURCE_NODE_ID, label: 'XAA' });
  } else {
    edges.push({ id: `e:${ORIGIN_NODE_ID}->${RESOURCE_NODE_ID}`, source: ORIGIN_NODE_ID, target: RESOURCE_NODE_ID, label: 'User' });
  }

  return { nodes, edges, agentNodeIds: agentIds };
}

// Mirrors Exercise's hopsByNodeId ("what did THIS node send out") / incomingByNodeId ("what did
// THIS node receive") convention from usePathRunner.ts, but derived directly from a trace instead
// of an ordered click-driven steps array — this graph observes state, it doesn't accumulate it
// click-by-click, so there's no history to replay, just "what's true right now".
export function deriveChatChips(
  login: TokenResult | null, hops: ChatHopTrace[], agentIds: string[]
): { hopsByNodeId: Map<string, HopResult[]>; incomingByNodeId: Record<string, HopResult> } {
  const hopsByNodeId = new Map<string, HopResult[]>();
  const incomingByNodeId: Record<string, HopResult> = {};

  if (login) {
    hopsByNodeId.set(ORIGIN_NODE_ID, [{ label: 'User Login', result: login, tokenType: 'ID' }]);
    if (agentIds.length > 0) incomingByNodeId[agentIds[0]] = { label: 'User Login', result: login, tokenType: 'ID' };
  }

  hops.forEach((h, i) => {
    const nodeId = agentIds[i];
    const targetNodeId = i < agentIds.length - 1 ? agentIds[i + 1] : RESOURCE_NODE_ID;
    const exchangeHop: HopResult = { label: `Exchange → ${i < hops.length - 1 ? hops[i + 1].agentName : 'Campaigns MCP'}`, result: h.exchange, tokenType: 'JAG' };
    // No redemption means the exchange itself failed — only show the (red) exchange chip, nothing
    // downstream ever received a token from this hop.
    if (!h.redemption) { hopsByNodeId.set(nodeId, [exchangeHop]); return; }
    const redemptionHop: HopResult = { label: `Redeem — ${h.agentName}`, result: h.redemption, tokenType: 'AT' };
    hopsByNodeId.set(nodeId, [exchangeHop, redemptionHop]);
    incomingByNodeId[targetNodeId] = redemptionHop;
  });

  return { hopsByNodeId, incomingByNodeId };
}

export { ORIGIN_NODE_ID, RESOURCE_NODE_ID };
