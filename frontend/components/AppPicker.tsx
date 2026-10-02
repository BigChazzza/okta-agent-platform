'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, X, Blocks } from 'lucide-react';

interface AppOption { id: string; label: string; applicationType?: string; }
interface Props {
  onSelect: (app: AppOption) => void;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function AppPicker({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<AppOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    setError('');
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${BACKEND}/api/apps?q=${encodeURIComponent(query)}&limit=20`);
        const data = await res.json();
        setApps(Array.isArray(data) ? data : []);
        if (!Array.isArray(data) && data.error) setError(data.error);
      } catch (e: any) {
        setError(e.message || 'Failed to load apps');
        setApps([]);
      }
      setLoading(false);
    }, 300);
  }, [query]);

  return (
    <div>
      <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 mb-3">
        <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Okta apps by name…"
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
        {loading && <div className="text-xs text-slate-500 text-center py-4">Searching…</div>}
        {!loading && !error && apps.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">
            {query ? 'No apps match that search' : 'Start typing to search apps'}
          </div>
        )}
        {apps.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a)}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#0a0f1e] rounded-lg transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-[#fb923c]/15 flex items-center justify-center flex-shrink-0">
              <Blocks className="w-3.5 h-3.5 text-[#fb923c]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#f1f5f9] font-medium truncate">{a.label}</div>
              {a.applicationType && <div className="text-xs text-slate-500 truncate">{a.applicationType}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
