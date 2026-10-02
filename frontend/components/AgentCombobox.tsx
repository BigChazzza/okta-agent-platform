'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, Bot } from 'lucide-react';

interface AgentOption { id: string; name: string; }

// Single-line type-ahead combobox: shows the selected agent's name, and on focus opens a floating
// dropdown that refines as you type — never reserves vertical space beyond one input row, since
// the results float over whatever's below instead of pushing it down.
export default function AgentCombobox<T extends AgentOption>({
  agents, value, onSelect, placeholder = 'Search AI agents by name…', emptyMessage = 'No agents match that search',
}: {
  agents: T[];
  value: string;
  onSelect: (agent: T) => void;
  placeholder?: string;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedName = agents.find((a) => a.id === value)?.name || '';

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as globalThis.Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-2.5 py-1.5">
        <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <input
          value={open ? query : selectedName}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          title={!open && selectedName ? selectedName : undefined}
          className="flex-1 bg-transparent text-sm text-[#f1f5f9] placeholder-slate-500 outline-none min-w-0 truncate"
        />
      </div>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 max-h-64 overflow-y-auto bg-[#111827] border border-[#1e293b] rounded-lg shadow-lg z-10 py-1">
          {filtered.length === 0 && (
            <div className="text-xs text-slate-500 text-center py-4">{query ? 'No agents match that search' : emptyMessage}</div>
          )}
          {filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => { onSelect(a); setOpen(false); setQuery(''); }}
              title={a.name}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#0a0f1e] transition-colors text-left"
            >
              <div className="w-6 h-6 rounded-full bg-[#1662dd]/15 flex items-center justify-center flex-shrink-0">
                <Bot className="w-3 h-3 text-[#1662dd]" />
              </div>
              <div className="text-sm text-[#f1f5f9] font-medium truncate">{a.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
