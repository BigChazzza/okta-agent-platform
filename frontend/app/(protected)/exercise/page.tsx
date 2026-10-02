import { apiFetch } from '@/lib/api';
import ExerciseGraph from './graph/ExerciseGraph';

interface AgentOption { id: string; name: string; oktaAgentId?: string; }

export default async function ExercisePage() {
  let agents: AgentOption[] = [];
  try { agents = await apiFetch<AgentOption[]>('/api/agents'); } catch {}

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Exercise Agent</h1>
        <p className="text-slate-400 text-sm mt-1">
          Run live token requests against onboarded agents — click a node to walk its real OAuth delegation chain against Okta.
        </p>
      </div>

      <ExerciseGraph agents={agents} />
    </div>
  );
}
