'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ArrowLeft, Bot } from 'lucide-react';

export default function NewAgentPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': (session?.user as any)?.id || '',
        },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create agent');
      }
      const agent = await res.json();
      router.push(`/agents/${agent.id}`);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <Link href="/agents" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Agents
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#1662dd]/15 flex items-center justify-center">
          <Bot className="w-5 h-5 text-[#60a5fa]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Register AI Agent</h1>
          <p className="text-slate-400 text-xs mt-0.5">Creates an identity in Okta's AI Agent directory</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-[#111827] border border-[#1e293b] rounded-xl p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Agent Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales Intelligence Agent"
            required
            className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#1662dd] transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
            rows={3}
            className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#1662dd] transition-colors resize-none"
          />
        </div>
        {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-3 pt-1">
          <Link href="/agents" className="px-4 py-2.5 text-sm font-medium text-slate-400 border border-[#1e293b] rounded-lg hover:text-white hover:border-slate-500 transition-colors">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 px-4 py-2.5 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? 'Registering…' : 'Register Agent in Okta'}
          </button>
        </div>
      </form>
    </div>
  );
}
