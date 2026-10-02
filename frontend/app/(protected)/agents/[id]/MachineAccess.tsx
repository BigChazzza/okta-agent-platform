'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Bot, Blocks, RefreshCw } from 'lucide-react';
import AgentPicker from '@/components/AgentPicker';
import AppPicker from '@/components/AppPicker';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Caller { id: string; callerAgentId: string; callerName: string; callerType?: 'agent' | 'app'; }
interface AgentOption { id: string; name: string; }
interface AppOption { id: string; label: string; }

// Streamlined Machine Access caller management — picks a caller (agent or app), submits, and the
// backend handles computing the audience/resource URL and connecting the shared authorization
// server (EXERCISE_SHARED_AUTH_SERVER_ID) in one request.
export default function MachineAccess({ agentId }: { agentId: string }) {
  const [callers, setCallers] = useState<Caller[]>([]);
  const [loadingCallers, setLoadingCallers] = useState(true);
  const [picking, setPicking] = useState(false);
  const [callerType, setCallerType] = useState<'agent' | 'app'>('agent');
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');

  const loadCallers = useCallback(async () => {
    setLoadingCallers(true);
    try {
      const r = await fetch(`${BACKEND}/api/agents/${agentId}/delegations`);
      const d = await r.json();
      setCallers(Array.isArray(d) ? d : []);
    } catch { setCallers([]); }
    setLoadingCallers(false);
  }, [agentId]);

  useEffect(() => { loadCallers(); }, [loadCallers]);

  async function assignAgent(agent: AgentOption) {
    setAssigning(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/machine-access/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerAgentId: agent.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to add caller'); setAssigning(false); return; }
      setPicking(false);
      await loadCallers();
    } catch (e: any) { setError(e.message); }
    setAssigning(false);
  }

  async function assignApp(app: AppOption) {
    setAssigning(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/machine-access/assign-app`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: app.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to add caller'); setAssigning(false); return; }
      setPicking(false);
      await loadCallers();
    } catch (e: any) { setError(e.message); }
    setAssigning(false);
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Authorized Callers ({loadingCallers ? '…' : callers.length})
          </span>
          <button
            onClick={() => { setPicking((o) => !o); setError(''); }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add caller
          </button>
        </div>

        {loadingCallers ? (
          <div className="text-xs text-slate-500 text-center py-4">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading callers…
          </div>
        ) : callers.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-[#1e293b] rounded-lg">
            No authorized callers yet
          </div>
        ) : (
          <div className="space-y-2">
            {callers.map((c) => (
              <div key={c.id} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.callerType === 'app' ? 'bg-[#fb923c]/15' : 'bg-[#a78bfa]/15'}`}>
                  {c.callerType === 'app' ? <Blocks className="w-4 h-4 text-[#fb923c]" /> : <Bot className="w-4 h-4 text-[#a78bfa]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#f1f5f9] truncate">{c.callerName}</div>
                  <div className="text-xs text-slate-500">{c.callerType === 'app' ? 'Service app' : 'AI agent'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && !picking && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">{error}</div>
      )}

      {picking && (
        <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#f1f5f9]">Add a caller</h3>
            <button onClick={() => setPicking(false)} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-1 mb-4 bg-[#111827] border border-[#1e293b] rounded-lg p-1">
            <button
              onClick={() => setCallerType('agent')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                callerType === 'agent' ? 'bg-[#1e293b] text-[#f1f5f9]' : 'text-slate-400'
              }`}
            >
              <Bot className="w-3.5 h-3.5" /> AI agent
            </button>
            <button
              onClick={() => setCallerType('app')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                callerType === 'app' ? 'bg-[#1e293b] text-[#f1f5f9]' : 'text-slate-400'
              }`}
            >
              <Blocks className="w-3.5 h-3.5" /> Service app
            </button>
          </div>
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 mb-3">{error}</div>}
          {assigning ? (
            <div className="text-xs text-slate-500 text-center py-6">
              <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Authorizing…
            </div>
          ) : callerType === 'agent' ? (
            <AgentPicker excludeAgentId={agentId} onSelect={assignAgent} />
          ) : (
            <AppPicker onSelect={assignApp} />
          )}
        </div>
      )}
    </div>
  );
}
