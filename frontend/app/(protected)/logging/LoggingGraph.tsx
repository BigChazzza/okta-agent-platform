'use client';
import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RefreshCw, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import type { TokenResult } from '@/components/TokenStepCard';
import TokenInspectorPanel, { type TokenInspectorTarget } from '@/components/TokenInspectorPanel';
import AgentNode from '@/components/graph/nodes/AgentNode';
import AppNode from '@/components/graph/nodes/AppNode';
import OriginNode from '@/components/graph/nodes/OriginNode';
import ResourceNode from '@/components/graph/nodes/ResourceNode';
import type { AgentOption } from '@/components/graph/graphTypes';
import { buildLogGraph, layoutLogGraph, chainLabels, isTruncatedChain, type LogInteraction, type InteractionGroup } from './logGraph';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';
const NODE_TYPES = { agent: AgentNode, app: AppNode, origin: OriginNode, resource: ResourceNode };

const TIME_RANGES = [
  { label: 'Last 1 hour', hours: 1 },
  { label: 'Last 6 hours', hours: 6 },
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 7 days', hours: 24 * 7 },
];

interface ActorOption { id: string; type: string; displayName?: string; }
interface ResourceOption { type: string; name: string; }

function Select({ label, value, onChange, options, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold text-slate-400 flex-shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-2 py-1.5 text-sm text-[#f1f5f9] outline-none disabled:opacity-50 min-w-0"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function InteractionRow({ group, agents }: {
  group: InteractionGroup; agents: AgentOption[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedRootTokenId, setSelectedRootTokenId] = useState(group.latest.rootTokenId);
  const [inspecting, setInspecting] = useState<TokenInspectorTarget | null>(null);
  const failed = group.latest.hops.some((h) => h.outcome !== 'SUCCESS');
  const truncated = isTruncatedChain(group.latest);
  const chain = useMemo(() => chainLabels(buildLogGraph(group.latest, agents).nodes), [group, agents]);
  const selected = group.occurrences.find((o) => o.rootTokenId === selectedRootTokenId) || group.latest;

  function inspectToken(mode: 'request' | 'response', label: string, step: TokenResult) {
    setInspecting({ mode, label, step });
  }

  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#0a0f1e] transition-colors"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
        {failed ? <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
        <span className="text-xs text-slate-400 flex-shrink-0 w-40">{new Date(group.latest.startedAt).toLocaleString()}</span>
        <span className="text-sm font-medium text-[#f1f5f9] truncate flex-1 uppercase">
          {truncated && <span className="text-slate-600 font-normal">… → </span>}
          {chain.length > 0 ? chain.join(' → ') : 'Unknown'}
        </span>
        {truncated && (
          <span
            title="This chain's caller acted before the selected time range — widen the range to see it"
            className="text-xs font-medium text-slate-500 bg-[#0a0f1e] border border-[#1e293b] rounded-full px-2 py-0.5 flex-shrink-0"
          >
            truncated
          </span>
        )}
        {group.occurrences.length > 1 && (
          <span className="text-xs font-semibold text-[#60a5fa] bg-[#1662dd]/10 rounded-full px-2 py-0.5 flex-shrink-0">×{group.occurrences.length}</span>
        )}
        <span className="text-xs text-slate-400 flex-shrink-0">{group.latest.hops.length} hop{group.latest.hops.length === 1 ? '' : 's'}</span>
      </button>
      {expanded && (
        <>
          {group.occurrences.length > 1 && (
            <div className="flex items-center gap-1.5 px-4 py-2 border-t border-[#1e293b] overflow-x-auto">
              {group.occurrences.map((o) => {
                const isFailed = o.hops.some((h) => h.outcome !== 'SUCCESS');
                const isSelected = o.rootTokenId === selectedRootTokenId;
                return (
                  <button
                    key={o.rootTokenId}
                    onClick={() => setSelectedRootTokenId(o.rootTokenId)}
                    className={`flex-shrink-0 text-[11px] px-2 py-1 rounded-full border transition-colors ${
                      isSelected
                        ? 'border-[#1662dd] bg-[#1662dd]/10 text-[#60a5fa] font-semibold'
                        : isFailed
                          ? 'border-red-500/30 bg-red-500/10 text-red-400 hover:border-red-500/50'
                          : 'border-[#1e293b] text-slate-400 hover:border-[#1662dd]/40'
                    }`}
                  >
                    {new Date(o.startedAt).toLocaleTimeString()}
                  </button>
                );
              })}
            </div>
          )}
          <InteractionGraph interaction={selected} agents={agents} onInspect={inspectToken} />
          <div className="border-t border-[#1e293b] p-4">
            <TokenInspectorPanel target={inspecting} />
          </div>
        </>
      )}
    </div>
  );
}

function InteractionGraph({ interaction, agents, onInspect }: {
  interaction: LogInteraction; agents: AgentOption[];
  onInspect: (mode: 'request' | 'response', label: string, step: TokenResult) => void;
}) {
  const { nodes, edges, hopsByNodeId, incomingByNodeId } = useMemo(() => buildLogGraph(interaction, agents), [interaction, agents]);
  const layoutedNodes = useMemo(() => layoutLogGraph(nodes, edges), [nodes, edges]);

  const flowNodes: Node[] = layoutedNodes.map((n) => ({
    id: n.id, type: n.type, position: n.position,
    data: {
      ...n.data, selected: false, onSelect: () => {},
      hops: hopsByNodeId.get(n.id), incoming: incomingByNodeId[n.id], onInspect,
      ...(n.data.kind === 'resource' ? { readOnly: true } : {}),
    },
  }));
  const flowEdges: Edge[] = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

  return (
    <div className="border-t border-[#1e293b]" style={{ height: 220 }}>
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
  );
}

export default function LoggingGraph({ agents }: { agents: AgentOption[] }) {
  const [hours, setHours] = useState(TIME_RANGES[0].hours);
  const [callerId, setCallerId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [resourceName, setResourceName] = useState('');

  const [interactionGroups, setInteractionGroups] = useState<InteractionGroup[]>([]);
  const [actorOptions, setActorOptions] = useState<ActorOption[]>([]);
  const [resourceOptions, setResourceOptions] = useState<ResourceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ hours: String(hours) });
    if (callerId) params.set('actorId', callerId);
    if (agentId) params.set('agentId', agentId);
    if (resourceType) params.set('resourceType', resourceType);
    if (resourceName) params.set('resourceName', resourceName);

    fetch(`${BACKEND}/api/logging/interactions?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); setInteractionGroups([]); return; }
        setInteractionGroups(d.interactionGroups || []);
        setActorOptions(d.filterOptions?.actors || []);
        setResourceOptions(d.filterOptions?.resources || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [hours, callerId, agentId, resourceType, resourceName]);

  const knownAgentIds = new Set(agents.map((a) => a.oktaAgentId).filter(Boolean));
  const callerOptions = actorOptions.filter((a) => !knownAgentIds.has(a.id));
  const agentOptions = actorOptions.filter((a) => knownAgentIds.has(a.id));
  const resourceTypeOptions = Array.from(new Set(resourceOptions.map((r) => r.type)));
  const resourceNameOptions = resourceOptions.filter((r) => !resourceType || r.type === resourceType);

  return (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center gap-4">
        <Select
          label="Time range"
          value={String(hours)}
          onChange={(v) => setHours(Number(v))}
          options={TIME_RANGES.map((r) => ({ value: String(r.hours), label: r.label }))}
        />
        <Select
          label="Caller"
          value={callerId}
          onChange={setCallerId}
          options={callerOptions.map((a) => ({ value: a.id, label: a.displayName || a.id }))}
        />
        <Select
          label="Agent"
          value={agentId}
          onChange={setAgentId}
          options={agentOptions.map((a) => ({ value: a.id, label: a.displayName || a.id }))}
        />
        <Select
          label="Resource type"
          value={resourceType}
          onChange={(v) => { setResourceType(v); setResourceName(''); }}
          options={resourceTypeOptions.map((t) => ({ value: t, label: t }))}
        />
        <Select
          label="Resource"
          value={resourceName}
          onChange={setResourceName}
          options={resourceNameOptions.map((r) => ({ value: r.name, label: r.name }))}
        />
        {loading && <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />}
      </div>

      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">{error}</div>}

      {!loading && !error && interactionGroups.length === 0 && (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-8 text-center text-sm text-slate-400">
          No matching activity in this time range.
        </div>
      )}

      <div className="space-y-2">
        {interactionGroups.map((group) => (
          <InteractionRow key={group.shapeKey} group={group} agents={agents} />
        ))}
      </div>
    </div>
  );
}
