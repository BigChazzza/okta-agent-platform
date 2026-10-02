import { apiFetch } from '@/lib/api';
import ChatClient from './ChatClient';

interface AgentOption { id: string; name: string; description?: string; }

export default async function ChatPage() {
  let agents: AgentOption[] = [];
  try { agents = await apiFetch<AgentOption[]>('/api/chat/eligible-agents'); } catch {}

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Chat</h1>
        <p className="text-slate-400 text-sm mt-1">
          Talk to an AI agent that accesses marketing campaigns through Cross-App Access.
        </p>
      </div>

      <ChatClient agents={agents} />
    </div>
  );
}
