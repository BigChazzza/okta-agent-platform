'use client';
import { useState, useEffect } from 'react';
import { Search, X, Bot } from 'lucide-react';

interface AgentOption { id: string; name: string; description?: string; }
interface Props {
  excludeAgentId: string;
  onSelect: (agent: AgentOption) => void;
  endpoint?: string;
  emptyMessage?: string;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function AgentPicker({ excludeAgentId, onSelect, endpoint = '/api/agents', emptyMessage }: Props) {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${BACKEND}${endpoint}`)
      .then((r) => r.json())
      .then((data) => setAgents(Array.isArray(data) ? data.filter((a: AgentOption) => a.id !== excludeAgentId) : []))
      .catch((e) => setError(e.message || 'Failed to load agents'))
      .finally(() => setLoading(false));
  }, [excludeAgentId, endpoint]);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 mb-3">
        <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search AI agents by name…"
          className="flex-1 bg-transparent text-sm text-[#f1f5f9] placeholder-slate-500 outline-none min-w-0"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-slate-500 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {error && <div className="text-xs text-red-400 mb-2 px-1">{error}</div>}
      <div className="max-h-56 overflow-y-auto space-y-0.5">
        {loading && <div className="text-xs text-slate-500 text-center py-4">Loading agents…</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">
            {query ? 'No agents match that search' : emptyMessage || 'No other agents available'}
          </div>
        )}
        {filtered.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#0a0f1e] rounded-lg transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-[#1662dd]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#f1f5f9] font-medium truncate">{a.name}</div>
              {a.description && <div className="text-xs text-slate-500 truncate">{a.description}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
