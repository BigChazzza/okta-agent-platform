'use client';
import { useState, useEffect, useCallback } from 'react';
import { Check, X, Plus, Shield, Server, Zap, Link2, Trash2, RefreshCw, ChevronRight, ArrowLeft } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface AgentConnection {
  id: string; connectionType: string; status: string; orn?: string;
  authorizationServer?: { name: string; issuerUrl?: string; orn: string };
  resource?: any; resourceIndicator?: string; scopeCondition?: string; scopes?: string[];
}

// ── Admin-console resource type definitions ───────────────────────────────────

const RESOURCE_TYPES = [
  {
    id: 'auth_server',
    label: 'Authorization server',
    description: 'Select a custom authorization server. Allows the agent to gain access to resources protected by it.',
    connectionTypes: ['IDENTITY_ASSERTION_CUSTOM_AS'],
    icon: Shield,
    colour: '#60a5fa',
  },
  {
    id: 'secret',
    label: 'Secret',
    description: 'Select a stored secret in Okta Privileged Access that your AI agent should be allowed access.',
    connectionTypes: ['STS_VAULT_SECRET'],
    icon: Server,
    colour: '#f87171',
  },
  {
    id: 'service_account',
    label: 'Service account',
    description: 'Select the service account in Okta Privileged Access that your AI agent should be allowed to access.',
    connectionTypes: ['STS_SERVICE_ACCOUNT'],
    icon: Zap,
    colour: '#fb923c',
  },
  {
    id: 'application',
    label: 'Application',
    description: 'Select an app configured in Okta or a custom resource server for AI Agent access.',
    connectionTypes: ['STS_ACCESS_TOKEN', 'IDENTITY_ASSERTION_APP_INSTANCE'],
    icon: Zap,
    colour: '#34d399',
  },
  {
    id: 'mcp_server',
    label: 'MCP server',
    description: 'Select a Model Context Protocol (MCP) server for your AI agent to access.',
    connectionTypes: ['IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER'],
    icon: Server,
    colour: '#e879f9',
  },
  {
    id: 'ai_agent',
    label: 'Connect to another AI agent',
    description: 'Set up a bilateral connection with another AI agent as a resource.',
    connectionTypes: ['IDENTITY_ASSERTION_A2A_SERVER'],
    icon: Link2,
    colour: '#a78bfa',
  },
] as const;

type ResourceTypeId = typeof RESOURCE_TYPES[number]['id'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function connectionName(conn: PotentialConnection | AgentConnection): string {
  if (conn.authorizationServer?.name) return conn.authorizationServer.name;
  const r = (conn as any).resource;
  if (r?.appInstanceName) return r.appInstanceName;
  if (r?.name) return r.name;
  if (r?.clientAuthSettings?.name) return r.clientAuthSettings.name;
  return conn.connectionType;
}

function connectionSub(conn: PotentialConnection | AgentConnection): string {
  if (conn.authorizationServer?.issuerUrl) return conn.authorizationServer.issuerUrl;
  const orn = conn.authorizationServer?.orn || (conn as any).resource?.orn || (conn as any).resource?.clientAuthSettings?.orn || '';
  return orn ? orn.substring(0, 60) + (orn.length > 60 ? '…' : '') : '';
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface Props { agentId: string; }

export default function ResourcePicker({ agentId }: Props) {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [allPotential, setAllPotential] = useState<PotentialConnection[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [loadingPotential, setLoadingPotential] = useState(true);

  // Picker state: null = closed, resourceTypeId = step 2
  const [step, setStep] = useState<'closed' | 'type' | ResourceTypeId>('closed');

  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const r = await fetch(`${BACKEND}/api/agents/${agentId}/connections`);
      const d = await r.json();
      setConnections(Array.isArray(d) ? d : []);
    } catch { setConnections([]); }
    setLoadingConnections(false);
  }, [agentId]);

  useEffect(() => {
    loadConnections();
    // Load potential connections once
    fetch(`${BACKEND}/api/agents/${agentId}/potential-connections`)
      .then(r => r.json())
      .then(d => setAllPotential(Array.isArray(d) ? d : []))
      .catch(() => setAllPotential([]))
      .finally(() => setLoadingPotential(false));
  }, [agentId, loadConnections]);

  // ── Connected ORNs (to skip already-connected items) ──────────────────────
  const connectedOrns = new Set(connections.map(c =>
    c.authorizationServer?.orn ||
    (c as any).resource?.orn ||
    (c as any).resource?.clientAuthSettings?.orn || ''
  ).filter(Boolean));

  // ── Add connection ─────────────────────────────────────────────────────────
  async function addConnection(conn: PotentialConnection) {
    const key = JSON.stringify(conn);
    setAdding(key); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create connection'); setAdding(null); return; }
      await loadConnections();
      setStep('closed');
    } catch (e: any) { setError(e.message); }
    setAdding(null);
  }

  // ── Remove connection ──────────────────────────────────────────────────────
  async function removeConnection(connId: string) {
    setRemoving(connId); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections/${connId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to remove'); setRemoving(null); return; }
      setConnections(prev => prev.filter(c => c.id !== connId));
    } catch (e: any) { setError(e.message); }
    setRemoving(null);
  }

  // ── Filtered potential connections for selected type ───────────────────────
  const selectedType = step !== 'closed' && step !== 'type'
    ? RESOURCE_TYPES.find(t => t.id === step)
    : null;

  const filteredConnections = selectedType
    ? allPotential.filter(p =>
        (selectedType.connectionTypes as readonly string[]).includes(p.connectionType) &&
        !connectedOrns.has(
          p.authorizationServer?.orn || p.resource?.orn || p.resource?.clientAuthSettings?.orn || ''
        )
      )
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Active connections list */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Active Connections ({loadingConnections ? '…' : connections.length})
          </span>
          <button
            onClick={() => { setStep('type'); setError(''); }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add resource connection
          </button>
        </div>

        {loadingConnections ? (
          <div className="text-xs text-slate-500 text-center py-4">
            <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading connections…
          </div>
        ) : connections.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-[#1e293b] rounded-lg">
            No resource connections yet
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => {
              const typeDef = RESOURCE_TYPES.find(t => (t.connectionTypes as readonly string[]).includes(c.connectionType));
              const Icon = typeDef?.icon || Shield;
              const colour = typeDef?.colour || '#64748b';
              return (
                <div key={c.id} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${colour}1a` }}>
                    <Icon className="w-4 h-4" style={{ color: colour }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{connectionName(c)}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 truncate">{typeDef?.label || c.connectionType}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                        c.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'
                      }`}>{c.status}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeConnection(c.id)}
                    disabled={removing === c.id}
                    className="text-slate-600 hover:text-red-400 transition-colors p-1 flex-shrink-0"
                    title="Remove connection"
                  >
                    {removing === c.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
          {error}
          <button onClick={() => setError('')}><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* ── Step 1: Select resource type ── */}
      {step === 'type' && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Add resource connection</h3>
            <button onClick={() => setStep('closed')} className="text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-slate-500 mb-4">Select a resource type</p>
          <div className="space-y-2">
            {RESOURCE_TYPES.map((type) => {
              const Icon = type.icon;
              const available = allPotential.filter(p =>
                (type.connectionTypes as readonly string[]).includes(p.connectionType)
              ).length;
              return (
                <button
                  key={type.id}
                  onClick={() => { if (!loadingPotential) setStep(type.id); }}
                  disabled={loadingPotential}
                  className="w-full flex items-center gap-3 px-4 py-3.5 bg-[#0a0f1e] border border-[#1e293b] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors disabled:opacity-50 group"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${type.colour}1a` }}>
                    <Icon className="w-4 h-4" style={{ color: type.colour }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">{type.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{type.description}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {loadingPotential ? (
                      <RefreshCw className="w-3 h-3 text-slate-600 animate-spin" />
                    ) : available > 0 ? (
                      <span className="text-xs text-[#60a5fa] font-medium">{available} available</span>
                    ) : (
                      <span className="text-xs text-slate-600">None configured</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Step 2: Pick specific resource ── */}
      {selectedType && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setStep('type')}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <span className="text-slate-600">·</span>
            <h3 className="text-sm font-semibold text-white">{selectedType.label}</h3>
            <button onClick={() => setStep('closed')} className="ml-auto text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-slate-500 mb-3">Select a resource</p>

          {filteredConnections.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-[#1e293b] rounded-lg">
              {loadingPotential ? (
                <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading…</>
              ) : (
                `No ${selectedType.label.toLowerCase()} resources available or all are already connected`
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {filteredConnections.map((conn, idx) => {
                const key = JSON.stringify(conn);
                const isAdding = adding === key;
                const name = connectionName(conn);
                const sub = connectionSub(conn);
                const Icon = selectedType.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => addConnection(conn)}
                    disabled={!!adding}
                    className="w-full flex items-center gap-3 px-3 py-3 bg-[#0a0f1e] border border-[#1e293b] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors disabled:opacity-50"
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${selectedType.colour}1a` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: selectedType.colour }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{name}</div>
                      {sub && <div className="text-xs text-slate-500 truncate font-mono">{sub}</div>}
                    </div>
                    {isAdding ? (
                      <RefreshCw className="w-4 h-4 text-[#60a5fa] animate-spin flex-shrink-0" />
                    ) : (
                      <Plus className="w-4 h-4 text-slate-600 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
