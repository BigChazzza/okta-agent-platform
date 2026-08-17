'use client';
import { useState, useEffect, useRef } from 'react';
import { User, Search, Check } from 'lucide-react';

interface OktaUser { id: string; displayName: string; email: string; status: string; }
interface Props {
  agentId: string;
  currentOwner: { id: string; name: string; email: string } | null;
  onAssigned?: (user: OktaUser) => void;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function UserPicker({ agentId, currentOwner, onAssigned }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<OktaUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${BACKEND}/api/users?q=${encodeURIComponent(query)}&limit=10`);
        const data = await res.json();
        setUsers(data);
      } catch {}
      setLoading(false);
    }, 300);
  }, [query, open]);

  async function assign(user: OktaUser) {
    await fetch(`${BACKEND}/api/agents/${agentId}/owner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    setOpen(false);
    setSuccess(`Owner set to ${user.displayName}`);
    onAssigned?.(user);
    setTimeout(() => setSuccess(''), 3000);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {currentOwner ? (
          <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2">
            <div className="w-6 h-6 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa]">
              {currentOwner.name[0]?.toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-white">{currentOwner.name}</div>
              <div className="text-xs text-slate-500">{currentOwner.email}</div>
            </div>
          </div>
        ) : (
          <span className="text-sm text-slate-500 italic">No owner assigned</span>
        )}
        <button onClick={() => setOpen(!open)} className="text-xs text-[#60a5fa] hover:underline ml-3">
          {currentOwner ? 'Change' : 'Assign owner'}
        </button>
      </div>

      {success && <div className="text-xs text-emerald-400 mb-2 flex items-center gap-1"><Check className="w-3 h-3" />{success}</div>}

      {open && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-3">
          <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2 mb-3">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users…"
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
            />
          </div>
          <div className="max-h-52 overflow-y-auto space-y-0.5">
            {loading && <div className="text-xs text-slate-500 text-center py-3">Searching…</div>}
            {!loading && users.length === 0 && <div className="text-xs text-slate-500 text-center py-3">No users found</div>}
            {users.map((u) => (
              <button key={u.id} onClick={() => assign(u)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 rounded-lg transition-colors text-left">
                <div className="w-7 h-7 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa] flex-shrink-0">
                  {u.displayName[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-white font-medium truncate">{u.displayName}</div>
                  <div className="text-xs text-slate-500 truncate">{u.email}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
