import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Boxes } from 'lucide-react';
import type { AppNodeData } from '../graphTypes';
import TokenIcons, { type TokenIconsProps } from './TokenIcons';

// The service-client app (Machine Access's caller) is rendered as a normal app-caller node but
// doubles as the "start here" point for a Machine Access chain — same identity, so no separate
// origin node — styled with a dashed border and the same "Start here" header OriginNode.tsx uses
// for User Access, so both start points read consistently regardless of which access pattern
// they're for.
export default function AppNode({ data }: NodeProps & { data: AppNodeData & TokenIconsProps & { selected: boolean; onSelect: () => void } }) {
  return (
    <div
      onClick={data.onSelect}
      className={`relative w-56 rounded-lg border bg-[#111827] px-3 py-2.5 shadow-sm cursor-pointer transition-colors ${
        data.isMachineOrigin ? 'border-dashed' : ''
      } ${
        data.selected ? 'border-[#1662dd] ring-2 ring-[#1662dd]/30' : 'border-[#1e293b] hover:border-[#1662dd]/40'
      }`}
    >
      <TokenIcons hops={data.hops} incoming={data.incoming} onInspect={data.onInspect} />
      <Handle type="target" position={Position.Left} className="!bg-[#1e293b]" />
      <Handle type="source" position={Position.Right} className="!bg-[#1e293b]" />
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <Boxes className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            {data.isMachineOrigin ? 'Start here' : 'Application'}
          </div>
          <div className="text-sm font-semibold text-[#f1f5f9] truncate">{data.name}</div>
        </div>
      </div>
    </div>
  );
}
