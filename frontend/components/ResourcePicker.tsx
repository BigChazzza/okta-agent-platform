'use client';
import { useState, useEffect } from 'react';
import { Puzzle, Check } from 'lucide-react';

interface Resource { id: string; name: string; type: string; description?: string; }
interface Props { agentId: string; assignedResources: Resource[]; }

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const typeColour: Record<string, string> = {
  mcp_server: 'bg-purple-500/15 text-purple-400',
  saas_app:   'bg-blue-500/15 text-blue-400',
  cloud_ai:   'bg-emerald-500/15 text-emerald-400',
  api:        'bg-amber-500/15 text-amber-400',
};

export default function ResourcePicker({ agentId, assignedResources }: Props) {
  const [all, setAll] = useState<Resource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedResources.map((r) => r.id)));
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND}/api/resources`).then((r) => r.json()).then(setAll).catch(() => {});
  }, []);

  function toggle(id: string) {
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  async function save() {
    setSaving(true);
    await fetch(`${BACKEND}/api/agents/${agentId}/resources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceIds: Array.from(selected) }),
    });
    setSaving(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  }

  const grouped = all.reduce<Record<string, Resource[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  const typeLabel: Record<string, string> = { mcp_server: 'MCP Servers', saas_app: 'SaaS Apps', cloud_ai: 'Cloud AI', api: 'APIs' };

  return (
    <div>
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="mb-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{typeLabel[type] || type}</div>
          <div className="grid grid-cols-2 gap-2">
            {items.map((r) => {
              const on = selected.has(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggle(r.id)}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${on ? 'border-[#1662dd]/40 bg-[#1662dd]/8' : 'border-[#1e293b] bg-[#0a0f1e] hover:border-slate-600'}`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${on ? 'bg-[#1662dd] border-[#1662dd]' : 'border-slate-600'}`}>
                    {on && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{r.name}</div>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColour[r.type] || 'bg-slate-500/15 text-slate-400'}`}>{type.replace('_', ' ')}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
          {saving ? 'Saving…' : 'Save Resources'}
        </button>
        {success && <span className="text-xs text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" />Saved!</span>}
      </div>
    </div>
  );
}
