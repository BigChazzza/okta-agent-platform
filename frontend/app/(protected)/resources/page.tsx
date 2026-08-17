import { apiFetch, Resource } from '@/lib/api';
import { Puzzle, Server, Cloud, Globe, Database, Shield } from 'lucide-react';

const typeConfig: Record<string, { label: string; icon: any; colour: string }> = {
  mcp_server:  { label: 'MCP Server',          icon: Server,   colour: '#8b5cf6' },
  cloud_ai:    { label: 'Cloud AI',             icon: Cloud,    colour: '#10b981' },
  saas_app:    { label: 'SaaS App',             icon: Globe,    colour: '#1662dd' },
  api:         { label: 'API',                  icon: Database, colour: '#f59e0b' },
  auth_server: { label: 'Okta Auth Server',     icon: Shield,   colour: '#60a5fa' },
};

export default async function ResourcesPage() {
  let resources: Resource[] = [];
  try { resources = await apiFetch<Resource[]>('/api/resources'); } catch {}

  const grouped = resources.reduce<Record<string, Resource[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Resources</h1>
        <p className="text-slate-400 text-sm mt-1">Connectable resources that can be assigned to AI agents</p>
      </div>

      {resources.length === 0 ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl py-14 text-center">
          <Puzzle className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="text-slate-400 text-sm">No resources found</div>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([type, items]) => {
            const cfg = typeConfig[type] || { label: type, icon: Puzzle, colour: '#64748b' };
            const Icon = cfg.icon;
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4" style={{ color: cfg.colour }} />
                  <h2 className="text-sm font-semibold text-slate-300">{cfg.label}s</h2>
                  <span className="text-xs text-slate-600">{items.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {items.map((r) => (
                    <div key={r.id} className="bg-[#111827] border border-[#1e293b] rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${cfg.colour}20` }}>
                          <Icon className="w-4 h-4" style={{ color: cfg.colour }} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{r.name}</div>
                          {r.description && <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{r.description}</div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
