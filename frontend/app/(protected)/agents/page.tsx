import Link from 'next/link';
import { apiFetch, Agent, Resource } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Bot, Plus, User, Puzzle, Shield } from 'lucide-react';

const typeColour: Record<string, string> = {
  mcp_server:  'bg-purple-500/15 text-purple-400',
  saas_app:    'bg-blue-500/15 text-blue-400',
  cloud_ai:    'bg-emerald-500/15 text-emerald-400',
  api:         'bg-amber-500/15 text-amber-400',
  auth_server: 'bg-[#1662dd]/15 text-[#60a5fa]',
};

function initials(name: string) {
  return name?.trim()?.[0]?.toUpperCase() || '?';
}

export default async function AgentsPage() {
  let agents: (Agent & { resources?: Resource[] })[] = [];
  try {
    // Fetch all agents with their resources included
    const list = await apiFetch<Agent[]>('/api/agents');
    agents = await Promise.all(
      list.map(async (a) => {
        try {
          const detail = await apiFetch<Agent & { resources: Resource[] }>(`/api/agents/${a.id}`);
          return detail;
        } catch {
          return { ...a, resources: [] };
        }
      })
    );
  } catch {}

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Agents</h1>
          <p className="text-slate-400 text-sm mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} registered in Okta
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
          <p className="text-slate-400 text-sm mb-5">Create your first AI agent and register it with Okta</p>
          <Link href="/agents/new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#1662dd] text-white text-sm rounded-lg font-semibold">
            <Plus className="w-4 h-4" /> Create Agent
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${a.id}`}
              className="block bg-[#111827] border border-[#1e293b] rounded-xl p-5 hover:border-[#1662dd]/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: icon + name + id */}
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-5 h-5 text-[#60a5fa]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-white text-sm">{a.name}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    {a.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md">{a.description}</p>
                    )}
                    {a.oktaAgentId && (
                      <div className="flex items-center gap-1 mt-1">
                        <Shield className="w-3 h-3 text-slate-600" />
                        <span className="text-xs text-slate-600 font-mono">{a.oktaAgentId}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Owner + Resources row */}
              <div className="flex items-center gap-6 mt-4 pt-3 border-t border-[#1e293b] flex-wrap">
                {/* Owner */}
                <div className="flex items-center gap-2 min-w-0">
                  {a.ownerId ? (
                    <>
                      <div className="w-6 h-6 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa] flex-shrink-0">
                        {initials(a.ownerName || '')}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white truncate">{a.ownerName}</div>
                        {a.ownerEmail && <div className="text-xs text-slate-500 truncate">{a.ownerEmail}</div>}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <User className="w-3.5 h-3.5" />
                      <span className="italic">No owner assigned</span>
                    </div>
                  )}
                </div>

                {/* Resources */}
                {(a.resources?.length ?? 0) > 0 ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {a.resources!.slice(0, 4).map((r) => (
                      <span key={r.id} className={`text-xs px-2 py-0.5 rounded font-medium ${typeColour[r.type] || 'bg-slate-500/15 text-slate-400'}`}>
                        {r.name}
                      </span>
                    ))}
                    {(a.resources!.length ?? 0) > 4 && (
                      <span className="text-xs text-slate-500">+{a.resources!.length - 4} more</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Puzzle className="w-3.5 h-3.5" />
                    <span className="italic">No resources connected</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
