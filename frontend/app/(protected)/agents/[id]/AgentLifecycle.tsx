'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, ZapOff, RefreshCw, CheckCircle } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Props { agentId: string; currentStatus: string; }

export default function AgentLifecycle({ agentId, currentStatus }: Props) {
  const [status, setStatus] = useState(currentStatus?.toLowerCase() || 'staged');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function lifecycle(action: 'activate' | 'deactivate') {
    setLoading(true); setError(''); setMessage('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `Failed to ${action}`); return; }
      const newStatus = action === 'activate' ? 'active' : 'inactive';
      setStatus(newStatus);
      setMessage(action === 'activate'
        ? '✅ Agent activated — credentials are now available below'
        : '✅ Agent deactivated');
      router.refresh(); // Re-fetch server component to show appId + credentials
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }

  const isActive = status === 'active';
  const isStaged = status === 'staged';
  const isInactive = status === 'inactive';

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
        <span className={`px-2 py-0.5 rounded-full font-semibold border ${
          isActive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
          : isStaged ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
          : 'bg-slate-500/15 text-slate-400 border-slate-500/25'
        }`}>{status.toUpperCase()}</span>
        {isStaged && <span className="text-slate-500">— Add connections, then activate to issue credentials</span>}
        {isActive && <span className="text-slate-500">— Agent is live and can authenticate</span>}
        {isInactive && <span className="text-slate-500">— Agent is disabled</span>}
      </div>

      <div className="flex gap-2">
        {(isStaged || isInactive) && (
          <button
            onClick={() => lifecycle('activate')}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? 'Activating…' : 'Activate Agent'}
          </button>
        )}
        {isActive && (
          <button
            onClick={() => lifecycle('deactivate')}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ZapOff className="w-4 h-4" />}
            {loading ? 'Deactivating…' : 'Deactivate'}
          </button>
        )}
      </div>

      {message && (
        <div className="mt-3 text-xs text-emerald-400 flex items-center gap-1.5">
          <CheckCircle className="w-3.5 h-3.5" />{message}
        </div>
      )}
      {error && <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>}
    </div>
  );
}
