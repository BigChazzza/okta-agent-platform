'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export default function DeleteAgent({ agentId, agentName }: { agentId: string; agentName: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function del() {
    setLoading(true);
    await fetch(`${BACKEND}/api/agents/${agentId}`, { method: 'DELETE' });
    router.push('/agents');
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-400">Delete &ldquo;{agentName}&rdquo;?</span>
        <button onClick={del} disabled={loading} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg">
          {loading ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button onClick={() => setConfirm(false)} className="text-xs text-slate-400 hover:text-white">Cancel</button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirm(true)} className="flex items-center gap-2 px-3 py-2 border border-red-500/25 text-red-400 hover:bg-red-500/10 text-xs font-semibold rounded-lg transition-colors">
      <Trash2 className="w-3.5 h-3.5" /> Delete Agent
    </button>
  );
}
