import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import UserPicker from '@/components/UserPicker';
import ResourcePicker from '@/components/ResourcePicker';
import AgentLifecycle from './AgentLifecycle';
import AgentCredentials from './AgentCredentials';
import { ArrowLeft, Bot, Shield, Calendar, Key } from 'lucide-react';

export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  let agent: any;
  try {
    agent = await apiFetch<any>(`/api/agents/${params.id}`);
  } catch {
    notFound();
  }

  const liveStatus = agent.okta?.status || agent.status;
  const currentOwner = agent.ownerId
    ? { id: agent.ownerId, name: agent.ownerName || '', email: agent.ownerEmail || '' }
    : null;

  return (
    <div className="max-w-2xl">
      <Link href="/agents" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> All Agents
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[#1662dd]/15 flex items-center justify-center">
          <Bot className="w-6 h-6 text-[#60a5fa]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">{agent.name}</h1>
          {agent.description && <p className="text-slate-400 text-sm mt-0.5">{agent.description}</p>}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <StatusBadge status={liveStatus} />
            {agent.oktaAgentId && (
              <span className="text-xs text-slate-600 font-mono bg-[#0d1525] px-2 py-0.5 rounded border border-[#1e293b]">
                {agent.oktaAgentId}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex items-center gap-3">
          <Calendar className="w-4 h-4 text-slate-500" />
          <div>
            <div className="text-xs text-slate-500">Created</div>
            <div className="text-sm text-white">
              {new Date(agent.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
            </div>
          </div>
        </div>
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-4 flex items-center gap-3">
          <Shield className="w-4 h-4 text-slate-500" />
          <div>
            <div className="text-xs text-slate-500">Okta Status</div>
            <div className="text-sm text-white capitalize">{liveStatus || '—'}</div>
          </div>
        </div>
      </div>

      {/* Lifecycle controls */}
      <section className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          Lifecycle
        </h2>
        <AgentLifecycle agentId={agent.id} currentStatus={liveStatus} />
      </section>

      {/* Owner */}
      <section className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1662dd]" />
          Owner
        </h2>
        <UserPicker agentId={agent.id} currentOwner={currentOwner} />
      </section>

      {/* Connections */}
      <section className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
          Resource Connections
          <span className="text-xs text-slate-500 font-normal">— Auth Servers, Apps, MCP Servers, Secrets & more</span>
        </h2>
        <ResourcePicker agentId={agent.id} />
      </section>

      {/* Credentials — only shown after activation */}
      <section className="bg-[#111827] border border-[#1e293b] rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Key className="w-3.5 h-3.5 text-amber-400" />
          Client Credentials
        </h2>
        {agent.okta?.appId ? (
          <AgentCredentials
            agentId={agent.id}
            appId={agent.okta.appId}
            clientId={agent.credentials?.clientId || agent.okta.appId}
            currentMethod={agent.credentials?.authMethod || 'client_secret_basic'}
          />
        ) : (
          <p className="text-sm text-slate-500 italic">
            Credentials are available after the agent is activated.
          </p>
        )}
      </section>

      {/* Danger zone */}
      <section className="bg-[#111827] border border-red-500/15 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-red-400 mb-2">Danger Zone</h2>
        <p className="text-xs text-slate-500 mb-3">Permanently deletes this agent from Okta and removes all data.</p>
        <DeleteAgentButton agentId={agent.id} agentName={agent.name} />
      </section>
    </div>
  );
}

// Inline delete button component
function DeleteAgentButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  return (
    // Delegate to client component
    <ClientDeleteButton agentId={agentId} agentName={agentName} />
  );
}

import ClientDeleteButton from './DeleteAgent';
