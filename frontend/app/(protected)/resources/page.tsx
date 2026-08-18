import { apiFetch } from '@/lib/api';
import { Shield, Server, Zap, Link2, AlertCircle } from 'lucide-react';

interface PotentialConnection {
  connectionType: string;
  authorizationServer?: { name: string; issuerUrl?: string; orn: string };
  resourceIndicator?: string;
  resource?: {
    appInstanceId?: string; appInstanceName?: string;
    clientAuthSettings?: { name: string; orn: string };
    orn?: string; name?: string;
  };
}

// Same category map as the admin console / ResourcePicker
const CATEGORIES = [
  {
    id: 'auth_server',
    label: 'Authorization Servers',
    description: 'Custom authorization servers — agents can gain access to resources protected by these.',
    types: ['IDENTITY_ASSERTION_CUSTOM_AS'],
    icon: Shield, colour: '#60a5fa',
  },
  {
    id: 'ai_agent',
    label: 'AI Agent Connections',
    description: 'Other AI agents in the org that can be connected as resources.',
    types: ['IDENTITY_ASSERTION_A2A_SERVER'],
    icon: Link2, colour: '#a78bfa',
  },
  {
    id: 'application',
    label: 'Applications',
    description: 'Okta apps and custom resource servers accessible via STS or identity assertion.',
    types: ['STS_ACCESS_TOKEN', 'IDENTITY_ASSERTION_APP_INSTANCE'],
    icon: Zap, colour: '#34d399',
  },
  {
    id: 'mcp_server',
    label: 'MCP Servers',
    description: 'Virtual Model Context Protocol servers registered in your Okta org.',
    types: ['IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER'],
    icon: Server, colour: '#e879f9',
  },
  {
    id: 'secret',
    label: 'Secrets',
    description: 'Stored secrets in Okta Privileged Access that agents can be granted access to.',
    types: ['STS_VAULT_SECRET'],
    icon: Shield, colour: '#f87171',
  },
  {
    id: 'service_account',
    label: 'Service Accounts',
    description: 'Service accounts in Okta Privileged Access that agents can be allowed to access.',
    types: ['STS_SERVICE_ACCOUNT'],
    icon: Server, colour: '#fb923c',
  },
] as const;

function resourceName(conn: PotentialConnection): string {
  if (conn.authorizationServer?.name) return conn.authorizationServer.name;
  const r = conn.resource;
  if (r?.appInstanceName) return r.appInstanceName;
  if (r?.name) return r.name;
  if (r?.clientAuthSettings?.name) return r.clientAuthSettings.name;
  return conn.connectionType;
}

function resourceOrn(conn: PotentialConnection): string {
  return conn.authorizationServer?.orn ||
    conn.resource?.orn ||
    conn.resource?.clientAuthSettings?.orn || '';
}

function resourceSub(conn: PotentialConnection): string {
  if (conn.authorizationServer?.issuerUrl) return conn.authorizationServer.issuerUrl;
  const orn = resourceOrn(conn);
  return orn ? orn.substring(0, 70) + (orn.length > 70 ? '…' : '') : '';
}

export default async function ResourcesPage() {
  let resources: PotentialConnection[] = [];
  let fetchError = '';

  try {
    resources = await apiFetch<PotentialConnection[]>('/api/resources');
  } catch (e: any) {
    fetchError = e.message;
  }

  const total = resources.length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Resources</h1>
        <p className="text-slate-400 text-sm mt-1">
          {total > 0
            ? `${total} resource${total !== 1 ? 's' : ''} available in your Okta org — fetched live`
            : 'Resources available in your Okta org for connecting to AI agents'}
        </p>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6 text-sm text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {fetchError}
        </div>
      )}

      {total === 0 && !fetchError ? (
        <div className="bg-[#111827] border border-[#1e293b] rounded-xl py-14 text-center">
          <Server className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <div className="text-slate-400 text-sm">No resources found — backend may still be starting</div>
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORIES.map((cat) => {
            const items = resources.filter(r =>
              (cat.types as readonly string[]).includes(r.connectionType)
            );
            if (items.length === 0) return null;
            const Icon = cat.icon;
            return (
              <div key={cat.id}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${cat.colour}1a` }}>
                    <Icon className="w-4 h-4" style={{ color: cat.colour }} />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-white">{cat.label}</h2>
                    <p className="text-xs text-slate-500">{cat.description}</p>
                  </div>
                  <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-white/5 text-slate-400">
                    {items.length}
                  </span>
                </div>

                {/* Resource cards */}
                <div className="grid grid-cols-2 gap-2">
                  {items.map((r, idx) => {
                    const name = resourceName(r);
                    const sub = resourceSub(r);
                    const orn = resourceOrn(r);
                    return (
                      <div
                        key={idx}
                        className="bg-[#111827] border border-[#1e293b] rounded-xl p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: `${cat.colour}1a` }}>
                            <Icon className="w-4 h-4" style={{ color: cat.colour }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-white truncate">{name}</div>
                            {sub && (
                              <div className="text-xs text-slate-500 mt-0.5 truncate font-mono">{sub}</div>
                            )}
                            {orn && orn !== sub && (
                              <div className="mt-1.5">
                                <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-slate-500 font-mono break-all line-clamp-2">
                                  {orn}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
