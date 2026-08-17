import Link from 'next/link';
import { apiFetch, Agent } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Bot, Plus, User, Puzzle } from 'lucide-react';

export default async function AgentsPage() {
  let agents: Agent[] = [];
  try { agents = await apiFetch<Agent[]>('/api/agents'); } catch {}

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Agents</h1>
          <p className="text-slate-400 text-sm mt-1">{agents.length} agent{agents.length !== 1 ? 's' : ''} registered in Okta</p>
        </div>
        <Link href="/agents/new" className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> New Agent
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl px-6 py-16 text-center">
          <Bot className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <div className="text-white font-medium mb-1">No agents yet</div>
          <p className="text-slate-400 text-sm mb-5">Create your first AI agent and register it with Okta</p>
          <Link href="/agents/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#1662dd] text-white text-sm rounded-lg font-semibold">
            <Plus className="w-4 h-4" /> Create Agent
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {agents.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-[#1662dd]/40 transition-colors flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[#1662dd]/15 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-[#60a5fa]" />
                </div>
                <div>
                  <div className="font-semibold text-white text-sm">{a.name}</div>
                  {a.description && <div className="text-xs text-slate-400 mt-0.5 max-w-xs truncate">{a.description}</div>}
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{a.ownerName || 'Unassigned'}</span>
                    <span className="flex items-center gap-1"><Puzzle className="w-3 h-3" />{a.resourceCount || 0} resources</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {a.oktaAgentId && <span className="text-xs text-slate-600 font-mono hidden lg:block">{a.oktaAgentId.substring(0, 12)}…</span>}
                <StatusBadge status={a.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
