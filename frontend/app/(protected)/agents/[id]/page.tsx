import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, Agent } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import UserPicker from '@/components/UserPicker';
import ResourcePicker from '@/components/ResourcePicker';
import { ArrowLeft, Bot, Shield, Calendar } from 'lucide-react';
import DeleteAgent from './DeleteAgent';

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  let agent: Agent;
  try {
    agent = await apiFetch<Agent>(`/api/agents/${params.id}`);
  } catch {
    notFound();
  }

  const currentOwner = agent.ownerId
    ? { id: agent.ownerId, name: agent.ownerName || '', email: agent.ownerEmail || '' }
    : null;

  return (
    <div className="max-w-2xl">
      <Link href="/agents" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> All Agents
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#1662dd]/15 flex items-center justify-center">
            <Bot className="w-6 h-6 text-[#60a5fa]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{agent.name}</h1>
            {agent.description && <p className="text-slate-400 text-sm mt-0.5">{agent.description}</p>}
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={agent.status} />
              {agent.oktaAgentId && (
                <span className="text-xs text-slate-600 font-mono bg-[#0d1525] px-2 py-0.5 rounded">
                  {agent.oktaAgentId}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex items-center gap-3">
          <Calendar className="w-4 h-4 text-slate-500" />
          <div>
            <div className="text-xs text-slate-500">Created</div>
            <div className="text-sm text-white">{new Date(agent.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex items-center gap-3">
          <Shield className="w-4 h-4 text-slate-500" />
          <div>
            <div className="text-xs text-slate-500">Okta Agent ID</div>
            <div className="text-sm text-white font-mono truncate">{agent.oktaAgentId || '—'}</div>
          </div>
        </div>
      </div>

      <section className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1662dd]" />
          Agent Owner
        </h2>
        <UserPicker agentId={agent.id} currentOwner={currentOwner} />
      </section>

      <section className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          Connected Resources
        </h2>
        <ResourcePicker agentId={agent.id} assignedResources={agent.resources || []} />
      </section>

      <section className="bg-[#111827] border border-red-500/15 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-red-400 mb-2">Danger Zone</h2>
        <p className="text-xs text-slate-500 mb-3">Permanently deregisters this agent from Okta and removes all data.</p>
        <DeleteAgent agentId={agent.id} agentName={agent.name} />
      </section>
    </div>
  );
}
