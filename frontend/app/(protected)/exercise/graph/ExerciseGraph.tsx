'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, type Node, type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { RefreshCw } from 'lucide-react';
import AgentCombobox from '@/components/AgentCombobox';
import type { TokenResult } from '@/components/TokenStepCard';
import TokenInspectorPanel, { type TokenInspectorTarget } from '@/components/TokenInspectorPanel';
import {
  fetchNeighbors, agentNodeId,
  type AgentOption, type GraphNode, type GraphEdge, type GraphNodeData, type AgentNodeData, type AppNodeData, type OriginNodeData,
} from './graphData';
import { usePathRunner } from './usePathRunner';
import AgentNode from '@/components/graph/nodes/AgentNode';
import AppNode from '@/components/graph/nodes/AppNode';
import ResourceNode from '@/components/graph/nodes/ResourceNode';
import OriginNode from '@/components/graph/nodes/OriginNode';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const NODE_TYPES = { agent: AgentNode, app: AppNode, resource: ResourceNode, origin: OriginNode };
const NODE_WIDTH = 224;
const NODE_HEIGHT = 56;

function layout(nodes: GraphNode[], edges: GraphEdge[]): { id: string; type: string; position: { x: number; y: number }; data: GraphNodeData }[] {
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

export default function ExerciseGraph({ agents }: { agents: AgentOption[] }) {
  return (
    <ReactFlowProvider>
      <ExerciseGraphInner agents={agents} />
    </ReactFlowProvider>
  );
}

function ExerciseGraphInner({ agents }: { agents: AgentOption[] }) {
  const [centerAgentId, setCenterAgentId] = useState('');
  const [rawNodes, setRawNodes] = useState<GraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<GraphEdge[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [inspecting, setInspecting] = useState<TokenInspectorTarget | null>(null);

  const runner = usePathRunner();
  const router = useRouter();
  const searchParams = useSearchParams();

  // pathNodeIds[i] is the node steps[i]'s token belongs to — a node can accumulate more than one
  // hop, grouped by node id and keyed by tokenType so retrying the same kind of request replaces
  // its chip instead of stacking a new one.
  const hopByNodeId = useMemo(() => {
    const byType = new Map<string, Map<string, (typeof runner.steps)[number]>>();
    runner.pathNodeIds.forEach((nodeId, i) => {
      const hop = runner.steps[i];
      if (!hop) return;
      const existing = byType.get(nodeId) || new Map<string, (typeof runner.steps)[number]>();
      existing.set(hop.tokenType, hop);
      byType.set(nodeId, existing);
    });
    const map = new Map<string, (typeof runner.steps)>();
    byType.forEach((types, nodeId) => map.set(nodeId, Array.from(types.values())));
    return map;
  }, [runner.pathNodeIds, runner.steps]);

  function inspectToken(mode: 'request' | 'response', label: string, step: TokenResult) {
    setInspecting({ mode, label, step });
  }

  function resolveHopTarget(nodeId: string, nodes: GraphNode[] = rawNodes): { kind: 'agent' | 'authserver'; id: string; label: string } | null {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    if (node.data.kind === 'agent') return { kind: 'agent', id: node.data.dashboardId, label: node.data.name };
    if (node.data.kind === 'resource') return { kind: 'authserver', id: node.data.connectionId, label: node.data.name };
    return null;
  }

  // A node's own next-hop target, resolved only when it has EXACTLY one outgoing edge. Resource
  // (authorization server) targets are excluded from auto-chaining — reaching one always requires
  // clicking it directly.
  function soleDownstream(
    nodeId: string, edges: GraphEdge[] = rawEdges, nodes: GraphNode[] = rawNodes
  ): { nodeId: string; kind: 'agent' | 'authserver'; id: string; label: string } | null {
    const outgoing = edges.filter((e) => e.source === nodeId);
    if (outgoing.length !== 1) return null;
    const target = resolveHopTarget(outgoing[0].target, nodes);
    if (target?.kind === 'authserver') return null;
    return target ? { nodeId: outgoing[0].target, ...target } : null;
  }

  const mergeGraph = useCallback((newNodes: GraphNode[], newEdges: GraphEdge[]) => {
    setRawNodes((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      return [...prev, ...newNodes.filter((n) => !ids.has(n.id))];
    });
    setRawEdges((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      return [...prev, ...newEdges.filter((e) => !ids.has(e.id))];
    });
  }, []);

  // Recursively fetches neighbors for `dashboardId` and every downstream agent node it leads to
  // (breadth-first, skipping ids already visited) so the whole reachable tree renders expanded
  // from the start instead of requiring a click on every intermediate agent.
  async function fetchFullTree(dashboardId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; expanded: Set<string> }> {
    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    const expanded = new Set<string>();
    const queue = [dashboardId];
    const seenAgentIds = new Set<string>([dashboardId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const { nodes: n, edges: e } = await fetchNeighbors(currentId, agents);
      const existingIds = new Set(allNodes.map((node) => node.id));
      allNodes.push(...n.filter((node) => !existingIds.has(node.id)));
      const existingEdgeIds = new Set(allEdges.map((edge) => edge.id));
      allEdges.push(...e.filter((edge) => !existingEdgeIds.has(edge.id)));
      expanded.add(agentNodeId(currentId));

      for (const node of n) {
        if (node.data.kind === 'agent' && !seenAgentIds.has(node.data.dashboardId)) {
          seenAgentIds.add(node.data.dashboardId);
          queue.push(node.data.dashboardId);
        }
      }
    }

    return { nodes: allNodes, edges: allEdges, expanded };
  }

  async function loadCenter(dashboardId: string) {
    setLoadingInitial(true);
    runner.reset();
    setExpandedIds(new Set());
    try {
      const { nodes: n, edges: e, expanded } = await fetchFullTree(dashboardId);
      setRawNodes(n);
      setRawEdges(e);
      setExpandedIds(expanded);
      setCenterAgentId(dashboardId);
    } finally {
      setLoadingInitial(false);
    }
  }

  async function expandAgent(agentDashboardId: string, nodeId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    setExpandingId(nodeId);
    try {
      const { nodes: n, edges: e } = await fetchNeighbors(agentDashboardId, agents);
      mergeGraph(n, e);
      setExpandedIds((prev) => new Set(prev).add(nodeId));
      return { nodes: n, edges: e };
    } finally {
      setExpandingId(null);
    }
  }

  // Resume a User Access path after the real Okta login redirect lands back here — the redirect
  // is a full page navigation, so in-memory path state can't survive it; agentId round-trips
  // through the backend's result payload.
  useEffect(() => {
    const resultRid = searchParams.get('result');
    const err = searchParams.get('error');
    if (err) { router.replace('/exercise'); return; }
    if (!resultRid) return;
    fetch(`${BACKEND}/api/exercise/agents/user-access/result/${resultRid}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error || !d.agentId) return;
        const { agentId: resultAgentId, ...decodedTokens } = d;
        loadCenter(resultAgentId).then(() => {
          const originId = `origin:user:${resultAgentId}`;
          runner.resumeFromLogin(resultRid, resultAgentId, originId, agentNodeId(resultAgentId), decodedTokens);
        });
      })
      .catch(() => {})
      .finally(() => router.replace('/exercise'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const layoutedNodes = useMemo(() => layout(rawNodes, rawEdges), [rawNodes, rawEdges]);

  // Before any click has happened, there's no real "current position" yet — but the "start here"
  // nodes (the service-client app, or a User Access origin) are still the next thing to click, so
  // their outgoing edges get the same highlight treatment a real current node's edges get.
  const highlightSources = useMemo(() => {
    if (runner.currentNodeId) return new Set([runner.currentNodeId]);
    const startNodeIds = rawNodes
      .filter((n) => n.data.kind === 'origin' || (n.data.kind === 'app' && n.data.isMachineOrigin))
      .map((n) => n.id);
    return new Set(startNodeIds);
  }, [runner.currentNodeId, rawNodes]);

  // Edge ids actually traveled so far — consecutive pairs in visitedNodeIds matched back against
  // the real edge between them.
  const traveledEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < runner.visitedNodeIds.length - 1; i++) {
      const from = runner.visitedNodeIds[i];
      const to = runner.visitedNodeIds[i + 1];
      const edge = rawEdges.find((e) => e.source === from && e.target === to);
      if (edge) ids.add(edge.id);
    }
    return ids;
  }, [runner.visitedNodeIds, rawEdges]);

  useEffect(() => {
    setNodes(
      layoutedNodes.map((n) => {
        const isAgent = n.data.kind === 'agent';
        const selected = n.id === runner.currentNodeId;
        return {
          ...n,
          data: {
            ...n.data,
            selected,
            onSelect: () => handleNodeClick(n),
            hops: hopByNodeId.get(n.id),
            incoming: runner.incomingByNodeId[n.id],
            onInspect: inspectToken,
            ...(isAgent ? { expanded: expandedIds.has(n.id), expanding: expandingId === n.id, onExpand: () => expandAgent((n.data as AgentNodeData).dashboardId, n.id) } : {}),
          },
        };
      })
    );
    setEdges(
      rawEdges.map((e) => {
        const traveled = traveledEdgeIds.has(e.id);
        const nextHop = highlightSources.has(e.source);
        return {
          id: e.id, source: e.source, target: e.target, label: e.label,
          animated: nextHop,
          style: traveled ? { stroke: '#10b981', strokeWidth: 2.5 } : nextHop ? { stroke: '#1662dd', strokeWidth: 2 } : undefined,
          labelStyle: { fontSize: 11, fill: '#94a3b8' },
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutedNodes, rawEdges, expandedIds, expandingId, runner.currentNodeId, hopByNodeId, runner.incomingByNodeId, highlightSources, traveledEdgeIds]);

  // Click model (4 clicks for a 3-hop chain — service app, caller agent, target agent, authz server):
  // 1. Click the "start here" node (app/origin) → gets the initial token, lands on the first agent.
  // 2. Click the current node itself → fires ITS OWN exchange toward its sole downstream.
  // 3. Click the pending exchange's target node → fires the redemption, auto-chaining into the
  //    landed node's own exchange if it also has exactly one outgoing edge.
  // 4. Click the (now pending) final target → redeems the last hop.
  async function handleNodeClick(n: { id: string; data: GraphNodeData }) {
    const data = n.data as any;
    if (data.kind === 'origin') {
      runner.startUser(data as OriginNodeData);
      return;
    }
    if (data.kind === 'app' && (data as AppNodeData).isMachineOrigin) {
      const targetEdge = rawEdges.find((e) => e.source === n.id);
      if (targetEdge) runner.startMachine(targetEdge.target.replace(/^agent:/, ''), n.id, targetEdge.target);
      return;
    }
    if (runner.pendingExchange && n.id === runner.pendingExchange.targetNodeId) {
      const result = await runner.runRedeem();
      if (result?.isAgentHop && result.nextRid) {
        if (!expandedIds.has(result.landedNodeId)) {
          const targetAgentData = resolveHopTarget(result.landedNodeId);
          if (targetAgentData) await expandAgent(targetAgentData.id, result.landedNodeId);
        }
        const next = soleDownstream(result.landedNodeId);
        if (next) runner.runExchange(next.kind, next.id, next.nodeId, next.label, { rid: result.nextRid, callerNodeId: result.landedNodeId });
      }
      return;
    }
    // Clicking a node directly downstream of the current position disambiguates which neighbor
    // to head toward when there's more than one option — runs both the exchange and the
    // redemption in sequence once that specific node is chosen.
    if (runner.currentNodeId && !runner.pendingExchange && n.id !== runner.currentNodeId) {
      const isDirectNeighbor = rawEdges.some((e) => e.source === runner.currentNodeId && e.target === n.id);
      if (isDirectNeighbor) {
        const target = resolveHopTarget(n.id);
        if (target) {
          const pending = await runner.runExchange(target.kind, target.id, n.id, target.label);
          if (pending) await runner.runRedeem(pending);
        }
        return;
      }
    }
    if (n.id === runner.currentNodeId && !runner.pendingExchange) {
      let freshEdges = rawEdges;
      let freshNodes = rawNodes;
      if (data.kind === 'agent' && !expandedIds.has(n.id)) {
        const merged = await expandAgent(data.dashboardId, n.id);
        freshEdges = [...rawEdges, ...merged.edges];
        freshNodes = [...rawNodes, ...merged.nodes];
      }
      const next = soleDownstream(n.id, freshEdges, freshNodes);
      if (next) runner.runExchange(next.kind, next.id, next.nodeId, next.label);
      return;
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl" style={{ height: 560 }}>
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1e293b] rounded-t-xl">
          <div className="flex items-center gap-2 w-72">
            <span className="text-xs font-semibold text-slate-400 flex-shrink-0">Agent</span>
            <div className="flex-1 min-w-0">
              <AgentCombobox agents={agents} value={centerAgentId} onSelect={(a) => loadCenter(a.id)} />
            </div>
          </div>
          {loadingInitial && <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />}
        </div>
        <div className="overflow-hidden rounded-b-xl" style={{ height: 'calc(100% - 45px)' }}>
          {centerAgentId ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={NODE_TYPES}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable style={{ background: '#0a0f1e' }} />
            </ReactFlow>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              Select an agent above to see its callers and downstream chain
            </div>
          )}
        </div>
      </div>

      {runner.error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">{runner.error}</div>
      )}

      <TokenInspectorPanel target={inspecting} />
    </div>
  );
}
