'use client';
import { useState } from 'react';
import { Copy, Check, RefreshCw, Key, Shield, Lock } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Props {
  agentId: string; appId: string; clientId: string; currentMethod: string;
}

const AUTH_METHODS = [
  {
    value: 'client_secret_basic',
    label: 'Client Secret',
    icon: Lock,
    description: 'Agent authenticates with a client ID and secret (OAuth2 client_secret_basic)',
  },
  {
    value: 'private_key_jwt',
    label: 'Public / Private Key',
    icon: Key,
    description: 'Agent uses a signed JWT with a private key — most secure option',
  },
  {
    value: 'none',
    label: 'Client ID Only',
    icon: Shield,
    description: 'Public client — PKCE only, no secret. Suitable for agents in trusted environments.',
  },
];

export default function AgentCredentials({ agentId, appId, clientId, currentMethod }: Props) {
  const [method, setMethod] = useState(currentMethod);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  async function saveMethod() {
    setSaving(true); setError(''); setSaved(false);
    try {
      const res = await fetch(`${BACKEND}/api/agents/${agentId}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authMethod: method }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to update'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      {/* Client ID — always shown */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client ID</label>
        <div className="flex items-center gap-2 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
          <span className="flex-1 text-sm text-white font-mono truncate">{clientId}</span>
          <button onClick={() => copy(clientId, 'clientId')} className="text-slate-500 hover:text-[#60a5fa] flex-shrink-0">
            {copied === 'clientId' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-1">
          Okta domain: <span className="font-mono">demo-ai-patterns.oktapreview.com</span>
        </p>
      </div>

      {/* Auth method picker */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Authentication Method</label>
        <div className="space-y-2">
          {AUTH_METHODS.map(({ value, label, icon: Icon, description }) => (
            <label
              key={value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                method === value
                  ? 'border-[#1662dd]/40 bg-[#1662dd]/8'
                  : 'border-[#1e293b] bg-[#0a0f1e] hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="authMethod"
                value={value}
                checked={method === value}
                onChange={() => setMethod(value)}
                className="mt-0.5 accent-[#1662dd] flex-shrink-0"
              />
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-white">{label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{description}</div>
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={saveMethod}
          disabled={saving || method === currentMethod}
          className="flex items-center gap-2 px-4 py-2 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save Credential Settings'}
        </button>
        {saved && <span className="text-xs text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" />Saved</span>}
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>}

      {method === 'private_key_jwt' && (
        <div className="bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-3 text-xs text-amber-300">
          <strong>Private Key JWT:</strong> Upload a public key to Okta Admin Console → Applications → {clientId} → Client Credentials tab, or use the Okta JWKS API at{' '}
          <span className="font-mono">/workload-principals/api/v1/ai-agents/{`{agentId}`}/credentials/jwks</span>
        </div>
      )}
    </div>
  );
}
