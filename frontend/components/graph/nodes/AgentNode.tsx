import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Bot, Plus, RefreshCw } from 'lucide-react';
import type { AgentNodeData } from '../graphTypes';
import TokenIcons, { type TokenIconsProps } from './TokenIcons';

export interface AgentNodeExtra extends TokenIconsProps {
  expanded?: boolean;
  expanding?: boolean;
  // Omitted entirely by read-only consumers (e.g. Logging's historical graph) — there's nothing
  // to expand into when the graph isn't driven by a live neighbor-fetch, so the button just
  // doesn't render.
  onExpand?: () => void;
  selected: boolean;
  onSelect: () => void;
}

export default function AgentNode({ data }: NodeProps & { data: AgentNodeData & AgentNodeExtra }) {
  return (
    <div
      onClick={data.onSelect}
      className={`relative w-56 rounded-lg border bg-[#111827] px-3 py-2.5 shadow-sm cursor-pointer transition-colors ${
        data.selected ? 'border-[#1662dd] ring-2 ring-[#1662dd]/30' : 'border-[#1e293b] hover:border-[#1662dd]/40'
      }`}
    >
      <TokenIcons hops={data.hops} incoming={data.incoming} onInspect={data.onInspect} />
      <Handle type="target" position={Position.Left} className="!bg-[#1e293b]" />
      <Handle type="source" position={Position.Right} className="!bg-[#1e293b]" />
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3.5 h-3.5 text-[#1662dd]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">AI agent</div>
          <div className="text-sm font-semibold text-[#f1f5f9] truncate">{data.name}</div>
        </div>
        {data.onExpand && !data.expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onExpand!(); }}
            title="Expand this agent's callers and downstream chain"
            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:text-[#1662dd] hover:bg-[#1662dd]/10 transition-colors"
          >
            {data.expanding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
