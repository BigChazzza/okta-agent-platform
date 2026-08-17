'use client';
import { useState, useEffect } from 'react';
import { Check, X, Plus, Shield, Server, Zap, Link2, Trash2, RefreshCw } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface PotentialConnection {
  connectionType: string;
  authorizationServer?: { name: string; issuerUrl: string; orn: string };
  resourceIndicator?: string;
  resource?: { appInstanceId?: string; appInstanceName?: string; clientAuthSettings?: { name: string; orn: string }; orn?: string };
}

interface AgentConnection {
  id: string; connectionType: string; status: string;
  authorizationServer?: { name: string; issuerUrl: string; orn: string };
  resource?: any; resourceIndicator?: string;
}

const typeConfig: Record<string, { label: string; icon: any; colour: string; bg: string }> = {
  IDENTITY_ASSERTION_CUSTOM_AS:      { label: 'Auth Server (Custom AS)',  icon: Shield,   colour: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  IDENTITY_ASSERTION_A2A_SERVER:     { label: 'Agent-to-Agent Server',    icon: Link2,    colour: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  IDENTITY_ASSERTION_APP_INSTANCE:   { label: 'App Instance',             icon: Zap,      colour: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  STS_ACCESS_TOKEN:                  { label: 'STS Access Token',         icon: Server,   colour: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  STS_VAULT_SECRET:                  { label: 'Vault Secret',             icon: Shield,   colour: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  STS_SERVICE_ACCOUNT:               { label: 'Service Account',          icon: Server,   colour: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER: { label: 'Virtual MCP Server',  icon: Server,   colour: '#e879f9', bg: 'rgba(232,121,249,0.12)' },
};

function connectionLabel(conn: PotentialConnection | AgentConnection): string {
  if ('authorizationServer' in conn && conn.authorizationServer) return conn.authorizationServer.name;
  if ('resource' in conn && conn.resource) {
    return (conn.resource as any).appInstanceName || (conn.resource as any).name || conn.connectionType;
  }
  return conn.connectionType;
}

function connectionSubtitle(conn: PotentialConnection | AgentConnection): string {
  if ('authorizationServer' in conn && conn.authorizationServer) return conn.authorizationServer.issuerUrl || '';
  if ('resource' in conn && conn.resource) {
    return (conn.resource as any).clientAuthSettings?.name || '';
  }
  return '';
}

interface Props { agentId: string; }

export default function ResourcePicker({ agentId }: Props) {
  const [potential, setPotential] = useState<PotentialConnection[]>([]);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loadingPotential, setLoadingPotential] = useState(true);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setLoadingConnections(true);
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections`);
      const data = await res.json();
      setConnections(Array.isArray(data) ? data : []);
    } catch { setConnections([]); }
    setLoadingConnections(false);
  }

  useEffect(() => {
    refresh();
    // Load potential connections
    setLoadingPotential(true);
    fetch(`${BACKEND}/api/agents/${agentId}/potential-connections`)
      .then(r => r.json())
      .then(d => setPotential(Array.isArray(d) ? d : []))
      .catch(() => setPotential([]))
      .finally(() => setLoadingPotential(false));
  }, [agentId]);

  async function addConnection(conn: PotentialConnection) {
    const key = JSON.stringify(conn);
    setAdding(key); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conn),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to create connection'); return; }
      await refresh();
      setShowPicker(false);
    } catch (e: any) { setError(e.message); }
    setAdding(null);
  }

  async function removeConnection(connId: string) {
    setRemoving(connId); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/connections/${connId}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed to remove'); return; }
      setConnections(prev => prev.filter(c => c.id !== connId));
    } catch (e: any) { setError(e.message); }
    setRemoving(null);
  }

  // Group potential connections by type, excluding already connected ones
  const connectedOrns = new Set(connections.map(c =>
    c.authorizationServer?.orn || c.resource?.orn || c.resource?.clientAuthSettings?.orn || ''
  ));
  const grouped = potential.reduce<Record<string, PotentialConnection[]>>((acc, p) => {
    const orn = p.authorizationServer?.orn || p.resource?.orn || p.resource?.clientAuthSettings?.orn || '';
    if (connectedOrns.has(orn) && orn) return acc; // skip already connected
    (acc[p.connectionType] = acc[p.connectionType] || []).push(p);
    return acc;
  }, {});

  return (
    <div>
      {/* Current connections */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Active Connections</span>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="text-xs text-slate-500 hover:text-white flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
            <button
              onClick={() => setShowPicker(s => !s)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 bg-[#1662dd]/15 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Connection
            </button>
          </div>
        </div>

        {loadingConnections ? (
          <div className="text-xs text-slate-500 py-3 text-center">Loading connections…</div>
        ) : connections.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-3 text-center border border-dashed border-[#1e293b] rounded-lg">
            No connections yet — add one below
          </div>
        ) : (
          <div className="space-y-2">
            {connections.map((c) => {
              const cfg = typeConfig[c.connectionType] || typeConfig.IDENTITY_ASSERTION_CUSTOM_AS;
              const Icon = cfg.icon;
              return (
                <div key={c.id} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                    <Icon className="w-4 h-4" style={{ color: cfg.colour }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{connectionLabel(c)}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500 truncate">{connectionSubtitle(c) || cfg.label}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        c.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'
                      }`}>{c.status}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeConnection(c.id)}
                    disabled={removing === c.id}
                    className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0 p-1"
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

      {/* Potential connections picker */}
      {showPicker && (
        <div className="bg-[#0d1525] border border-[#1e293b] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-white">Available Connections</span>
            <button onClick={() => setShowPicker(false)} className="text-slate-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {loadingPotential ? (
            <div className="text-xs text-slate-500 text-center py-4">Loading from Okta…</div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-4">
              All available connections are already active
            </div>
          ) : (
            <div className="space-y-4 max-h-80 overflow-y-auto">
              {Object.entries(grouped).map(([type, items]) => {
                const cfg = typeConfig[type] || { label: type, icon: Shield, colour: '#64748b', bg: 'rgba(100,116,139,0.12)' };
                const Icon = cfg.icon;
                return (
                  <div key={type}>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{cfg.label}</div>
                    <div className="space-y-1.5">
                      {items.map((conn, idx) => {
                        const key = JSON.stringify(conn);
                        const isAdding = adding === key;
                        return (
                          <button
                            key={idx}
                            onClick={() => addConnection(conn)}
                            disabled={!!adding}
                            className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#0a0f1e] border border-[#1e293b] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors disabled:opacity-50"
                          >
                            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: cfg.bg }}>
                              <Icon className="w-3.5 h-3.5" style={{ color: cfg.colour }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-white truncate">{connectionLabel(conn)}</div>
                              <div className="text-xs text-slate-500 truncate">{connectionSubtitle(conn)}</div>
                            </div>
                            {isAdding
                              ? <RefreshCw className="w-3.5 h-3.5 text-[#60a5fa] animate-spin flex-shrink-0" />
                              : <Plus className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                            }
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
