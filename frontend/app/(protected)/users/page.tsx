import { apiFetch, OktaUser } from '@/lib/api';
import { Users } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';

export default async function UsersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q || '';
  let users: OktaUser[] = [];
  try { users = await apiFetch<OktaUser[]>(`/api/users?q=${encodeURIComponent(q)}&limit=50`); } catch {}

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Okta Users</h1>
          <p className="text-slate-400 text-sm mt-1">{users.length} user{users.length !== 1 ? 's' : ''} in your tenant</p>
        </div>
      </div>

      <form className="mb-5">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search users by name or email…"
          className="w-full max-w-sm bg-[#111827] border border-[#1e293b] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#1662dd]"
        />
      </form>

      {users.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl py-14 text-center">
          <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="text-slate-400 text-sm">{q ? 'No users match that search' : 'No users found'}</div>
        </div>
      ) : (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2rem_1fr_1fr_6rem] gap-4 px-5 py-2.5 border-b border-[#1e293b] text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <div />
            <div>Name</div>
            <div>Email</div>
            <div>Status</div>
          </div>
          <div className="divide-y divide-[#1e293b]">
            {users.map((u) => (
              <div key={u.id} className="grid grid-cols-[2rem_1fr_1fr_6rem] gap-4 px-5 py-3 items-center hover:bg-white/2">
                <div className="w-7 h-7 rounded-full bg-[#1662dd]/20 flex items-center justify-center text-xs font-bold text-[#60a5fa]">
                  {u.displayName?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="text-sm text-white font-medium truncate">{u.displayName}</div>
                <div className="text-sm text-slate-400 truncate">{u.email}</div>
                <StatusBadge status={u.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
