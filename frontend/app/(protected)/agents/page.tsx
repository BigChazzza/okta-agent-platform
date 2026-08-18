import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Bot, Plus, User, Puzzle, Shield, Zap } from 'lucide-react';

interface AgentRow {
  id: string; name: string; description?: string; oktaAgentId?: string;
  ownerId?: string; ownerName?: string; ownerEmail?: string;
  status: string; oktaStatus?: string;
  resourceCount?: number; createdAt: string;
}

function initials(name?: string) { return name?.trim()?.[0]?.toUpperCase() || '?'; }

export default async function AgentsPage() {
  let agents: AgentRow[] = [];
  try { agents = await apiFetch<AgentRow[]>('/api/agents'); } catch {}

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Agents</h1>
          <p className="text-slate-400 text-sm mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} registered in Okta — live sync
          </p>
        </div>
        <Link href="/agents/new" className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> New Agent
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl px-6 py-16 text-center">
          <Bot className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <div className="text-white font-medium mb-1">No agents yet</div>
          <p className="text-slate-400 text-sm mb-5">Register your first AI agent in Okta</p>
          <Link href="/agents/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#1662dd] text-white text-sm rounded-lg font-semibold">
            <Plus className="w-4 h-4" /> Create Agent
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((a) => {
            const liveStatus = a.oktaStatus || a.status;
            return (
              <Link
                key={a.id}
                href={`/agents/${a.id}`}
                className="block bg-[#111827] border border-[#1e293b] rounded-xl p-4 hover:border-[#1662dd]/40 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-xl bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-[#60a5fa]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white text-sm">{a.name}</span>
                      <StatusBadge status={liveStatus} />
                    </div>
                    {a.description && <p className="text-xs text-slate-500 mt-0.5 truncate max-w-md">{a.description}</p>}
                    {a.oktaAgentId && (
                      <span className="text-xs text-slate-600 font-mono">{a.oktaAgentId}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 text-xs text-slate-500">
                    {a.ownerId ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa]">
                          {initials(a.ownerName)}
                        </div>
                        <span className="text-white text-xs">{a.ownerName}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-slate-600">
                        <User className="w-3.5 h-3.5" /><span className="italic">No owner</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-slate-600">
                      <Puzzle className="w-3.5 h-3.5" />
                      <span>{a.resourceCount || 0} connections</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
