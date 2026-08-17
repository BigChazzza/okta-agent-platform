import Link from 'next/link';
import { apiFetch, Agent } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Bot, Users, Puzzle, Plus } from 'lucide-react';

export default async function DashboardPage() {
  let agents: Agent[] = [];
  let resourceCount = 0;

  try {
    agents = await apiFetch<Agent[]>('/api/agents');
    const resources = await apiFetch<any[]>('/api/resources');
    resourceCount = resources.length;
  } catch {}

  const withOwners = agents.filter((a) => a.ownerId).length;
  const recent = agents.slice(0, 5);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-1">Manage your AI agents registered in Okta</p>
        </div>
        <Link
          href="/agents/new"
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> New Agent
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Agents', value: agents.length, icon: Bot, colour: '#1662dd' },
          { label: 'Agents with Owners', value: withOwners, icon: Users, colour: '#10b981' },
          { label: 'Available Resources', value: resourceCount, icon: Puzzle, colour: '#8b5cf6' },
        ].map(({ label, value, icon: Icon, colour }) => (
          <div key={label} className="bg-[#111827] border border-[#1e293b] rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${colour}22` }}>
                <Icon className="w-5 h-5" style={{ color: colour }} />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="text-xs text-slate-400">{label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-[#111827] border border-[#1e293b] rounded-xl">
        <div className="px-5 py-4 border-b border-[#1e293b] flex items-center justify-between">
          <h2 className="font-semibold text-white text-sm">Recent Agents</h2>
          <Link href="/agents" className="text-xs text-[#60a5fa] hover:underline">View all →</Link>
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-500 text-sm">
            No agents yet.{' '}
            <Link href="/agents/new" className="text-[#60a5fa] hover:underline">Create your first agent</Link>
          </div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {recent.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-white/3 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#1662dd]/15 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-[#60a5fa]" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{a.name}</div>
                    <div className="text-xs text-slate-500">{a.ownerName || 'No owner'} · {a.resourceCount || 0} resources</div>
                  </div>
                </div>
                <StatusBadge status={a.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
