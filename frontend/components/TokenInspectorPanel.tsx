'use client';
import { FileJson } from 'lucide-react';
import type { TokenResult } from './TokenStepCard';

function JsonBlock({ value }: { value: any }) {
  return (
    <pre className="text-[11px] text-slate-300 bg-[#0d1525] border border-[#1e293b] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed max-h-72">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export interface TokenInspectorTarget { mode: 'request' | 'response'; label: string; step: TokenResult; }

// Inline panel rendered below the graph canvas — clicking a node's request/response icon
// (TokenIcons.tsx) sets `target`, and this panel shows it in place rather than a popup.
export default function TokenInspectorPanel({ target }: { target: TokenInspectorTarget | null }) {
  if (!target) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 italic py-10 justify-center border border-dashed border-[#1e293b] rounded-xl">
        <FileJson className="w-3.5 h-3.5" /> Click a node's request or response icon to inspect its token here
      </div>
    );
  }

  const { mode, label, step } = target;
  return (
    <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#f1f5f9]">
            {mode === 'request' ? 'Request' : 'Response'} — {label}
          </h3>
          {mode === 'request' && step.request && (
            <p className="text-[11px] text-slate-600 mt-0.5 font-mono truncate">{step.request.tokenEndpoint}</p>
          )}
        </div>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${step.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
          {step.status}
        </span>
      </div>

      {mode === 'request' ? (
        <JsonBlock value={step.request?.body ?? 'No request captured'} />
      ) : step.decoded ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Header</div>
            <JsonBlock value={step.decoded.header} />
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Payload</div>
            <JsonBlock value={step.decoded.payload} />
          </div>
        </div>
      ) : (
        <JsonBlock value={step.raw} />
      )}
    </div>
  );
}
