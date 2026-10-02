'use client';
import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Waypoints, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { TokenResult } from '@/components/TokenStepCard';
import TokenInspectorPanel, { type TokenInspectorTarget } from '@/components/TokenInspectorPanel';
import AgentNode from '@/components/graph/nodes/AgentNode';
import OriginNode from '@/components/graph/nodes/OriginNode';
import ResourceNode from '@/components/graph/nodes/ResourceNode';
import { buildChatGraph, deriveChatChips, layoutChatGraph, type ChatAgentChainEntry, type ChatHopTrace } from './chatGraph';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
const NODE_TYPES = { agent: AgentNode, origin: OriginNode, resource: ResourceNode };

// Read-only mirror of Exercise's graph, scoped to Chat's own fixed token flow (User Login ->
// agent -> agent -> ... -> Campaigns authorization server) — this never drives an exchange
// itself, it just renders whatever the backend's own XAA chain already did on the most recent
// chat turn. Collapsed by default so it doesn't compete for attention with the chat transcript.
//
// The node SHAPE (which agents are in the chain) is fetched as soon as `agentId` is selected, via
// GET /:agentId/access-path — the same resolveCampaignsAccessPath BFS a real message would run,
// but with no tokens involved, so the graph shows every node up front the same way Exercise's
// fetchNeighbors does, instead of only after a real exchange has happened. Token chips overlay
// on top of that fixed shape once `hops`/`login` actually have data.
export default function ChatGraphPanel({
  agentId, login, hops, expanded, onToggleExpanded, canvasHeight,
}: {
  agentId: string | null;
  login: TokenResult | null;
  hops: ChatHopTrace[];
  // Expand/collapse and the canvas's height are controlled by ChatClient rather than owned here —
  // the drag handle that resizes this panel against the chat card above it lives in ChatClient, so
  // both need to agree on the same height value.
  expanded: boolean;
  onToggleExpanded: () => void;
  canvasHeight: number;
}) {
  const [inspecting, setInspecting] = useState<TokenInspectorTarget | null>(null);
  const [agentChain, setAgentChain] = useState<ChatAgentChainEntry[]>([]);
  const [loadingChain, setLoadingChain] = useState(false);

  useEffect(() => {
    if (!agentId) { setAgentChain([]); return; }
    setLoadingChain(true);
    fetch(`${BACKEND}/api/chat/${agentId}/access-path`)
      .then((r) => r.json())
      .then((d) => setAgentChain(Array.isArray(d.agentChain) ? d.agentChain : []))
      .catch(() => setAgentChain([]))
      .finally(() => setLoadingChain(false));
  }, [agentId]);

  const lastRedemptionScopes = useMemo(() => {
    const scp = hops[hops.length - 1]?.redemption?.decoded?.payload?.scp;
    return Array.isArray(scp) ? scp.join(', ') : undefined;
  }, [hops]);

  const { nodes, edges, agentNodeIds } = useMemo(
    () => buildChatGraph(agentChain, 'Campaigns MCP', lastRedemptionScopes ? `Scopes: ${lastRedemptionScopes}` : undefined),
    [agentChain, lastRedemptionScopes]
  );
  const { hopsByNodeId, incomingByNodeId } = useMemo(() => deriveChatChips(login, hops, agentNodeIds), [login, hops, agentNodeIds]);
  const layoutedNodes = useMemo(() => layoutChatGraph(nodes, edges), [nodes, edges]);

  function inspectToken(mode: 'request' | 'response', label: string, step: TokenResult) {
    setInspecting({ mode, label, step });
  }

  const flowNodes: Node[] = layoutedNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      ...n.data,
      selected: false,
      onSelect: () => {},
      hops: hopsByNodeId.get(n.id),
      incoming: incomingByNodeId[n.id],
      onInspect: inspectToken,
    },
  }));
  const flowEdges: Edge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label, labelStyle: { fontSize: 11, fill: '#64748b' } }));

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
      <button
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <Waypoints className="w-3.5 h-3.5 text-[#1662dd]" />
        <span className="text-sm font-semibold text-[#f1f5f9]">Token flow</span>
        <span className="ml-auto text-slate-500">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[#1e293b] p-4 space-y-4">
          {loadingChain ? (
            <div className="h-32 flex items-center justify-center text-sm text-slate-500">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Resolving access path…
            </div>
          ) : agentChain.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-slate-500">
              This agent has no path to the Campaigns authorization server
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[#1e293b] overflow-hidden" style={{ height: canvasHeight }}>
                <ReactFlowProvider>
                  <ReactFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={NODE_TYPES}
                    fitView
                    nodesDraggable={false}
                    nodesConnectable={false}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </ReactFlowProvider>
              </div>
              <TokenInspectorPanel target={inspecting} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
