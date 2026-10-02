import { apiFetch } from '@/lib/api';
import LoggingGraph from './LoggingGraph';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

export default async function LoggingPage() {
  let agents: AgentOption[] = [];
  try { agents = await apiFetch<AgentOption[]>('/api/agents'); } catch {}

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Logging</h1>
        <p className="text-slate-400 text-sm mt-1">
          Reconstructed token-flow history from Okta&apos;s System Log — read-only, filtered by time range, caller, agent, or resource.
        </p>
      </div>

      <LoggingGraph agents={agents} />
    </div>
  );
}
