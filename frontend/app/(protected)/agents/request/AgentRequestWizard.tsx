'use client';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Bot, Search, X, Check, UserCheck, Cpu, Key, Lock,
  Shield, Server, Zap, Link2, RefreshCw, CheckCircle2, ExternalLink, Plus, ChevronRight, Users,
  KeyRound, ShieldCheck, Clock, FileSearch, MessageSquare,
} from 'lucide-react';
import ScopeSelector from '@/components/ScopeSelector';
import ProvisioningPanel from '@/components/ProvisioningPanel';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface OktaUser { id: string; displayName: string; email: string; status: string; }
interface OktaGroup { id: string; name: string; description?: string; }
interface AgentOption { id: string; name: string; description?: string; }

// Closes an open picker when the user clicks anywhere outside it — used so switching between
// the Human Sign-In and Machine Access sections doesn't leave a stale search box open underneath
// the newly-focused one.
function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onOutside]);
  return ref;
}

interface PotentialConnection {
  connectionType: string;
  authorizationServer?: { name: string; issuerUrl?: string; orn: string };
  resource?: { appInstanceName?: string; name?: string; orn?: string; clientAuthSettings?: { name: string; orn: string } };
  selectedScopes?: string[];
}

const STEPS = ['Name & Owner', 'Access Pattern', 'Credentials', 'Resources', 'Review'] as const;
type Step = 0 | 1 | 2 | 3 | 4;

// Resources = what this agent calls OUT to. "Connect to another AI agent" (A2A) belongs here
// too — it's a distinct outbound resource type, separate from Machine Access in the Access
// Pattern step, which is about who's allowed to call INTO this agent.
const RESOURCE_TYPES = [
  { id: 'auth_server', label: 'Authorization server', connectionTypes: ['IDENTITY_ASSERTION_CUSTOM_AS'], icon: Shield, colour: '#60a5fa' },
  { id: 'application', label: 'Application', connectionTypes: ['STS_ACCESS_TOKEN', 'IDENTITY_ASSERTION_APP_INSTANCE'], icon: Zap, colour: '#34d399' },
  { id: 'mcp_server', label: 'MCP server', connectionTypes: ['IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER'], icon: Server, colour: '#e879f9' },
  { id: 'ai_agent', label: 'Connect to another AI agent', connectionTypes: ['IDENTITY_ASSERTION_A2A_SERVER'], icon: Link2, colour: '#a78bfa' },
  // Visual-only for now: Okta Privileged Access (a separate licensed SKU) governs service
  // account access. Clicking this shows an informational note instead of a live picker.
  { id: 'service_account', label: 'Service account', connectionTypes: [] as string[], icon: KeyRound, colour: '#f97316', infoOnly: true },
] as const;
type ResourceTypeId = typeof RESOURCE_TYPES[number]['id'];

// A2A entries carry a resource.orn identifying the target agent, distinct from the (often
// shared/reused) authorizationServer.orn — so resource.orn must win the tie-break here, otherwise
// two different A2A targets fronted by the same auth server would collide.
function connectionOrn(c: PotentialConnection): string {
  return c.resource?.orn || c.authorizationServer?.orn || c.resource?.clientAuthSettings?.orn || '';
}
function connectionName(c: PotentialConnection): string {
  if (c.connectionType === 'IDENTITY_ASSERTION_A2A_SERVER') return c.resource?.name || c.authorizationServer?.name || c.connectionType;
  return c.authorizationServer?.name || c.resource?.appInstanceName || c.resource?.clientAuthSettings?.name || c.connectionType;
}

// ── Reusable debounced user + group multi-picker (sign-in access) ─────────────
function UserGroupMultiPicker({
  selectedUsers, onUsersChange, selectedGroups, onGroupsChange,
}: {
  selectedUsers: OktaUser[]; onUsersChange: (users: OktaUser[]) => void;
  selectedGroups: OktaGroup[]; onGroupsChange: (groups: OktaGroup[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'users' | 'groups'>('users');
  const [query, setQuery] = useState('');
  const [userResults, setUserResults] = useState<OktaUser[]>([]);
  const [groupResults, setGroupResults] = useState<OktaGroup[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const selectedUserIds = new Set(selectedUsers.map((u) => u.id));
  const selectedGroupIds = new Set(selectedGroups.map((g) => g.id));
  const boxRef = useClickOutside(() => setOpen(false));

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        if (tab === 'users') {
          const res = await fetch(`${BACKEND}/api/users?q=${encodeURIComponent(query)}&limit=20`);
          const data = await res.json();
          setUserResults(Array.isArray(data) ? data : []);
        } else {
          const res = await fetch(`${BACKEND}/api/groups?q=${encodeURIComponent(query)}&limit=20`);
          const data = await res.json();
          setGroupResults(Array.isArray(data) ? data : []);
        }
      } catch { tab === 'users' ? setUserResults([]) : setGroupResults([]); }
    }, 300);
  }, [query, open, tab]);

  function toggleUser(u: OktaUser) {
    onUsersChange(selectedUserIds.has(u.id) ? selectedUsers.filter((s) => s.id !== u.id) : [...selectedUsers, u]);
  }
  function toggleGroup(g: OktaGroup) {
    onGroupsChange(selectedGroupIds.has(g.id) ? selectedGroups.filter((s) => s.id !== g.id) : [...selectedGroups, g]);
  }

  return (
    <div className="mt-3" ref={boxRef}>
      {(selectedUsers.length > 0 || selectedGroups.length > 0) && (
        <div className="space-y-1.5 mb-2">
          {selectedUsers.map((u) => (
            <div key={u.id} className="flex items-center gap-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2">
              <div className="w-6 h-6 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-[10px] font-bold text-[#60a5fa] flex-shrink-0">
                {u.displayName?.[0]?.toUpperCase() || '?'}
              </div>
              <span className="text-sm text-white flex-1 truncate">{u.displayName}</span>
              <button onClick={() => toggleUser(u)} className="text-slate-500 hover:text-red-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {selectedGroups.map((g) => (
            <div key={g.id} className="flex items-center gap-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2">
              <Users className="w-4 h-4 text-[#60a5fa] flex-shrink-0" />
              <span className="text-sm text-white flex-1 truncate">{g.name}</span>
              <span className="text-[10px] text-slate-500 flex-shrink-0">Group</span>
              <button onClick={() => toggleGroup(g)} className="text-slate-500 hover:text-red-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      {open ? (
        <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-2">
          <div className="flex items-center gap-1 mb-2">
            <button
              onClick={() => { setTab('users'); setQuery(''); }}
              className={`flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${tab === 'users' ? 'bg-[#1662dd]/15 text-[#60a5fa]' : 'text-slate-400'}`}
            >
              Users
            </button>
            <button
              onClick={() => { setTab('groups'); setQuery(''); }}
              className={`flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg transition-colors ${tab === 'groups' ? 'bg-[#1662dd]/15 text-[#60a5fa]' : 'text-slate-400'}`}
            >
              Groups
            </button>
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
            <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'users' ? 'Search users by name or email…' : 'Search groups by name…'}
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none min-w-0"
            />
            <button onClick={() => setOpen(false)}><X className="w-3.5 h-3.5 text-slate-500" /></button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {tab === 'users' && userResults.map((u) => (
              <button
                key={u.id}
                onClick={() => toggleUser(u)}
                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-white/5 rounded-lg transition-colors text-left"
              >
                <div className="w-6 h-6 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-[10px] font-bold text-[#60a5fa] flex-shrink-0">
                  {u.displayName?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white font-medium truncate">{u.displayName}</div>
                  <div className="text-xs text-slate-500 truncate">{u.email}</div>
                </div>
                {selectedUserIds.has(u.id) && <Check className="w-4 h-4 text-[#60a5fa] flex-shrink-0" />}
              </button>
            ))}
            {tab === 'groups' && groupResults.map((g) => (
              <button
                key={g.id}
                onClick={() => toggleGroup(g)}
                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-white/5 rounded-lg transition-colors text-left"
              >
                <Users className="w-4 h-4 text-[#60a5fa] flex-shrink-0" />
                <span className="text-sm text-white font-medium truncate flex-1">{g.name}</span>
                {selectedGroupIds.has(g.id) && <Check className="w-4 h-4 text-[#60a5fa] flex-shrink-0" />}
              </button>
            ))}
            {tab === 'groups' && groupResults.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-3">{query ? 'No groups match' : 'Start typing to search groups'}</div>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setOpen(true); setQuery(''); }}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/10 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add user/group
        </button>
      )}
    </div>
  );
}

// ── Reusable debounced agent multi-picker (machine-access callers) ────────────
function AgentMultiPicker({ selected, onChange }: { selected: AgentOption[]; onChange: (agents: AgentOption[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const selectedIds = new Set(selected.map((a) => a.id));
  const boxRef = useClickOutside(() => setOpen(false));

  useEffect(() => {
    if (!open || loaded) return;
    fetch(`${BACKEND}/api/agents`)
      .then((r) => r.json())
      .then((d) => setAgents(Array.isArray(d) ? d : []))
      .catch(() => setAgents([]))
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()));

  function toggle(a: AgentOption) {
    onChange(selectedIds.has(a.id) ? selected.filter((s) => s.id !== a.id) : [...selected, a]);
  }

  return (
    <div className="mt-3" ref={boxRef}>
      {selected.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {selected.map((a) => (
            <div key={a.id} className="flex items-center gap-2.5 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2">
              <Bot className="w-4 h-4 text-[#a78bfa] flex-shrink-0" />
              <span className="text-sm text-white flex-1 truncate">{a.name}</span>
              <button onClick={() => toggle(a)} className="text-slate-500 hover:text-red-400 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      {open ? (
        <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-2">
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
            <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search AI agents by name…"
              className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none min-w-0"
            />
            <button onClick={() => setOpen(false)}><X className="w-3.5 h-3.5 text-slate-500" /></button>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {!loaded && <div className="text-xs text-slate-500 text-center py-3">Loading agents…</div>}
            {loaded && filtered.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-3">No agents match</div>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => toggle(a)}
                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-white/5 rounded-lg transition-colors text-left"
              >
                <Bot className="w-4 h-4 text-[#a78bfa] flex-shrink-0" />
                <span className="text-sm text-white font-medium truncate flex-1">{a.name}</span>
                {selectedIds.has(a.id) && <Check className="w-4 h-4 text-[#60a5fa] flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/10 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add calling agent
        </button>
      )}
    </div>
  );
}

// ── Informational-only modal for Service Account resources ────────────────────
// Okta Privileged Access (a separate licensed SKU) governs service account access for agents —
// this is visual narration for the demo, not a live picker. No selection here is added to the
// request.
function ServiceAccountInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#111827] border border-[#1e293b] rounded-2xl p-6 max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Service accounts</h3>
            <p className="text-xs text-slate-500">Powered by Okta Privileged Access</p>
          </div>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Okta Privileged Access enables you to select the service account that your AI agent
          should be allowed to access.
        </p>
        <div className="space-y-3 mb-5">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#60a5fa] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-400">
              Replaces standing, hard-coded service account credentials with brokered access,
              closing off a common path for lateral movement and credential-based attacks.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-[#60a5fa] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-400">
              Agents get temporary, just-in-time access to the account instead of a permanent key
              embedded in code.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <FileSearch className="w-4 h-4 text-[#60a5fa] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-400">
              The full delegation path is traceable in Okta&apos;s System Log, so every use of the
              account is attributable back to the agent and its authorization.
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mb-4">
          Requires the Okta Privileged Access add-on. This step is illustrative for this
          walkthrough — no service account is attached to the request.
        </p>
        <button
          onClick={onClose}
          className="w-full px-4 py-2.5 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export default function AgentRequestWizard() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>(0);

  // Step 0
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState<OktaUser | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState<OktaUser[]>([]);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const ownerTimer = useRef<ReturnType<typeof setTimeout>>();

  // Step 1
  const [userAccess, setUserAccess] = useState(true);
  const [signInUsers, setSignInUsers] = useState<OktaUser[]>([]);
  const [signInGroups, setSignInGroups] = useState<OktaGroup[]>([]);
  const [machineAccess, setMachineAccess] = useState(false);
  const [callerAgents, setCallerAgents] = useState<AgentOption[]>([]);

  // Step 2 — client secret is the real, fully-automatable default (private_key_jwt on a backing
  // app requires a manual public-key upload in the Okta Admin Console, so it's listed second and
  // clearly marked as a manual follow-up step).
  const [credentialType, setCredentialType] = useState<'client_secret_basic' | 'private_key_jwt'>('client_secret_basic');

  // Step 3 — Resources: category-drill picker, mirroring the admin console's resource picker UX
  const [resources, setResources] = useState<PotentialConnection[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceStep, setResourceStep] = useState<'closed' | 'type' | ResourceTypeId>('closed');
  const [selectedConnections, setSelectedConnections] = useState<PotentialConnection[]>([]);
  const [showServiceAccountInfo, setShowServiceAccountInfo] = useState(false);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState<{ agentId?: string; adminConsoleUrl?: string } | null>(null);

  // Prefill owner from the logged-in session
  useEffect(() => {
    const email = (session?.user as any)?.email;
    if (!email || owner) return;
    fetch(`${BACKEND}/api/users?q=${encodeURIComponent(email)}&limit=1`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d) && d[0]) setOwner(d[0]); })
      .catch(() => {});
  }, [session]);

  // Owner search (only when actively changing owner)
  useEffect(() => {
    if (!ownerPickerOpen) return;
    clearTimeout(ownerTimer.current);
    ownerTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${BACKEND}/api/users?q=${encodeURIComponent(ownerQuery)}&limit=20`);
        const data = await res.json();
        setOwnerResults(Array.isArray(data) ? data : []);
      } catch { setOwnerResults([]); }
    }, 300);
  }, [ownerQuery, ownerPickerOpen]);

  // Load resources once, entering step 3
  useEffect(() => {
    if (step !== 3 || resources.length > 0) return;
    setLoadingResources(true);
    fetch(`${BACKEND}/api/resources`)
      .then((r) => r.json())
      .then((d) => setResources(Array.isArray(d) ? d : []))
      .catch(() => setResources([]))
      .finally(() => setLoadingResources(false));
  }, [step]);

  const selectedOrns = new Set(selectedConnections.map(connectionOrn));
  const selectedType = resourceStep !== 'closed' && resourceStep !== 'type'
    ? RESOURCE_TYPES.find((t) => t.id === resourceStep)
    : null;
  const filteredForType = selectedType
    ? resources.filter((r) => (selectedType.connectionTypes as readonly string[]).includes(r.connectionType))
    : [];

  function toggleConnection(conn: PotentialConnection) {
    const orn = connectionOrn(conn);
    setSelectedConnections((prev) =>
      prev.some((c) => connectionOrn(c) === orn) ? prev.filter((c) => connectionOrn(c) !== orn) : [...prev, conn]
    );
  }

  // Custom AS connections go through an extra confirm step (pick scopes, then Add) instead of
  // toggling straight into selectedConnections, same UX as the admin console's resource picker.
  const [pendingAuthServerOrn, setPendingAuthServerOrn] = useState<string | null>(null);
  const [pendingScopes, setPendingScopes] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    if (resourceStep !== 'auth_server') { setPendingAuthServerOrn(null); setPendingScopes(undefined); }
  }, [resourceStep]);

  const canAdvance =
    step === 0 ? name.trim().length > 0 && !!owner :
    step === 1 ? userAccess || machineAccess :
    true;

  async function submit() {
    setSubmitting(true); setSubmitError('');
    try {
      const res = await fetch(`${BACKEND}/api/agent-requests/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          ownerId: owner!.id,
          ownerName: owner!.displayName,
          ownerEmail: owner!.email,
          userAccess,
          signInUsers: signInUsers.map((u) => ({ id: u.id, displayName: u.displayName })),
          signInGroups: signInGroups.map((g) => ({ id: g.id, name: g.name })),
          machineAccess,
          machineCallerAgentIds: callerAgents.map((a) => a.id),
          credentialType,
          connections: selectedConnections,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setSubmitError(data.error || 'Request failed'); setSubmitting(false); return; }
      setSubmitted(data);
    } catch (e: any) {
      setSubmitError(e.message);
    }
    setSubmitting(false);
  }

  function resetForm() {
    setSubmitted(null); setStep(0);
    setName(''); setDescription('');
    setSignInUsers([]); setCallerAgents([]); setSelectedConnections([]);
  }

  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0">
        {submitted ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Request submitted</h1>
            <p className="text-slate-400 text-sm max-w-md mx-auto mb-8">
              Watch the provisioning panel for live progress. Your agent identity, owner, access
              pattern, credentials, and resource connections are being configured in Okta now.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              {submitted.adminConsoleUrl && (
                <a
                  href={submitted.adminConsoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#1662dd] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  View in Okta Admin Console <ExternalLink className="w-4 h-4" />
                </a>
              )}
              {submitted.agentId && (
                <a
                  href={`/chat?agentId=${submitted.agentId}`}
                  className="flex items-center gap-2 px-4 py-2.5 border border-[#1662dd]/40 text-[#60a5fa] hover:bg-[#1662dd]/10 text-sm font-semibold rounded-lg transition-colors"
                >
                  <MessageSquare className="w-4 h-4" /> Chat with Agent
                </a>
              )}
              <button
                onClick={resetForm}
                className="px-4 py-2.5 border border-[#1e293b] text-sm font-medium text-slate-400 hover:text-white rounded-lg transition-colors"
              >
                Submit another request
              </button>
            </div>
          </div>
        ) : (
          <div>
            <Link href="/agents" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white mb-6">
              <ArrowLeft className="w-4 h-4" /> Back to Agents
            </Link>

            {/* Step indicator */}
            <div className="flex items-center gap-2 mb-8">
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2 flex-1">
                  <div className={`flex items-center gap-2 ${i <= step ? 'text-[#60a5fa]' : 'text-slate-500'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      i < step ? 'bg-[#1662dd] text-white' : i === step ? 'border-2 border-[#1662dd]' : 'border-2 border-[#1e293b]'
                    }`}>
                      {i < step ? <Check className="w-3 h-3" /> : i + 1}
                    </div>
                    <span className="text-xs font-medium hidden sm:inline">{label}</span>
                  </div>
                  {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-[#1662dd]' : 'bg-[#1e293b]'}`} />}
                </div>
              ))}
            </div>

            <div className="bg-[#111827] border border-[#1e293b] rounded-xl p-6">
              {/* Step 0: Name & Owner */}
              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">What are you building?</h2>
                    <p className="text-sm text-slate-400">Give your agent a name and describe what it does.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Agent Name *</label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Campaign Asset Retriever"
                      className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#1662dd] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What does this agent do?"
                      rows={3}
                      className="w-full bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#1662dd] transition-colors resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Owner</label>
                    {owner && !ownerPickerOpen ? (
                      <div className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                        <div className="w-7 h-7 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#60a5fa] flex-shrink-0">
                          {owner.displayName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{owner.displayName}</div>
                          <div className="text-xs text-slate-500 truncate">{owner.email}</div>
                        </div>
                        <button
                          onClick={() => { setOwnerPickerOpen(true); setOwnerQuery(''); }}
                          className="text-xs font-semibold text-[#60a5fa] flex-shrink-0"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-lg p-2">
                        <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                          <Search className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                          <input
                            autoFocus
                            value={ownerQuery}
                            onChange={(e) => setOwnerQuery(e.target.value)}
                            placeholder="Search users by name or email…"
                            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none min-w-0"
                          />
                          {ownerQuery && (
                            <button onClick={() => setOwnerQuery('')}><X className="w-3.5 h-3.5 text-slate-500" /></button>
                          )}
                        </div>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {ownerResults.map((u) => (
                            <button
                              key={u.id}
                              onClick={() => { setOwner(u); setOwnerPickerOpen(false); }}
                              className="w-full flex items-center gap-3 px-2 py-2 hover:bg-white/5 rounded-lg transition-colors text-left"
                            >
                              <div className="w-6 h-6 rounded-full bg-[#1662dd]/15 flex items-center justify-center text-xs font-bold text-[#60a5fa] flex-shrink-0">
                                {u.displayName?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-white font-medium truncate">{u.displayName}</div>
                                <div className="text-xs text-slate-500 truncate">{u.email}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 1: Access Pattern */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">Who can call this agent?</h2>
                    <p className="text-sm text-slate-400">Select one or both, then choose who&apos;s authorized.</p>
                  </div>
                  <div className={`p-4 rounded-lg border transition-all ${userAccess ? 'border-[#1662dd]/50 bg-[#1662dd]/5' : 'border-[#1e293b] bg-[#0a0f1e]'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={userAccess} onChange={(e) => setUserAccess(e.target.checked)} className="mt-1 accent-[#1662dd]" />
                      <div className="flex items-start gap-3">
                        <UserCheck className="w-5 h-5 text-[#60a5fa] mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-white">Human sign-in (User Access)</div>
                          <div className="text-xs text-slate-400 mt-0.5">Select which people can sign in through this agent. Okta provisions the backing app automatically.</div>
                        </div>
                      </div>
                    </label>
                    {userAccess && (
                      <div className="ml-8">
                        <UserGroupMultiPicker
                          selectedUsers={signInUsers} onUsersChange={setSignInUsers}
                          selectedGroups={signInGroups} onGroupsChange={setSignInGroups}
                        />
                        {signInUsers.length === 0 && signInGroups.length === 0 && (
                          <p className="text-[11px] text-slate-500 mt-2">No one added yet — the owner will be granted sign-in access by default.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={`p-4 rounded-lg border transition-all ${machineAccess ? 'border-[#1662dd]/50 bg-[#1662dd]/5' : 'border-[#1e293b] bg-[#0a0f1e]'}`}>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={machineAccess} onChange={(e) => setMachineAccess(e.target.checked)} className="mt-1 accent-[#1662dd]" />
                      <div className="flex items-start gap-3">
                        <Cpu className="w-5 h-5 text-[#60a5fa] mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-white">Agent-to-agent (Machine Access)</div>
                          <div className="text-xs text-slate-400 mt-0.5">Select which other AI agents are authorized to call this one, with scoped delegation.</div>
                        </div>
                      </div>
                    </label>
                    {machineAccess && (
                      <div className="ml-8">
                        <AgentMultiPicker selected={callerAgents} onChange={setCallerAgents} />
                        {callerAgents.length === 0 && (
                          <p className="text-[11px] text-slate-500 mt-2">No callers added yet — machine access will be configured but no agent will be authorized to use it.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Credentials */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">How should this agent authenticate?</h2>
                    <p className="text-sm text-slate-400">Okta issues real credentials the moment the agent is created.</p>
                  </div>
                  <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${credentialType === 'client_secret_basic' ? 'border-[#1662dd]/50 bg-[#1662dd]/5' : 'border-[#1e293b] bg-[#0a0f1e]'}`}>
                    <input type="radio" name="cred" checked={credentialType === 'client_secret_basic'} onChange={() => setCredentialType('client_secret_basic')} className="mt-1 accent-[#1662dd]" />
                    <div className="flex items-start gap-3">
                      <Lock className="w-5 h-5 text-[#60a5fa] mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-semibold text-white">Client secret <span className="text-[10px] font-bold text-emerald-400 ml-1">RECOMMENDED</span></div>
                        <div className="text-xs text-slate-400 mt-0.5">A shared secret, auto-provisioned by Okta — ready to use immediately.</div>
                      </div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${credentialType === 'private_key_jwt' ? 'border-[#1662dd]/50 bg-[#1662dd]/5' : 'border-[#1e293b] bg-[#0a0f1e]'}`}>
                    <input type="radio" name="cred" checked={credentialType === 'private_key_jwt'} onChange={() => setCredentialType('private_key_jwt')} className="mt-1 accent-[#1662dd]" />
                    <div className="flex items-start gap-3">
                      <Key className="w-5 h-5 text-slate-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-semibold text-white">Public / private key</div>
                        <div className="text-xs text-slate-400 mt-0.5">Signed JWT authentication, no shared secret. For agents with Human Sign-In enabled, this requires a manual public-key upload in the Okta Admin Console after this request completes.</div>
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {/* Step 3: Resources — category-drill, mirrors the admin console's resource picker */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">Connect resources</h2>
                    <p className="text-sm text-slate-400">Select what this agent is allowed to call out to. Optional.</p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        Selected ({selectedConnections.length})
                      </span>
                      <button
                        onClick={() => setResourceStep('type')}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd]/10 border border-[#1662dd]/25 text-[#60a5fa] rounded-lg hover:bg-[#1662dd]/20 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add resource
                      </button>
                    </div>
                    {selectedConnections.length === 0 ? (
                      <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-[#1e293b] rounded-lg">
                        No resources selected yet
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedConnections.map((c) => {
                          const typeDef = RESOURCE_TYPES.find((t) => (t.connectionTypes as readonly string[]).includes(c.connectionType));
                          const Icon = typeDef?.icon || Shield;
                          return (
                            <div key={connectionOrn(c)} className="flex items-center gap-3 bg-[#0a0f1e] border border-[#1e293b] rounded-lg px-3 py-2.5">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${typeDef?.colour || '#64748b'}1a` }}>
                                <Icon className="w-4 h-4" style={{ color: typeDef?.colour || '#64748b' }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-white truncate">{connectionName(c)}</div>
                                <div className="text-xs text-slate-500">
                                  {typeDef?.label || c.connectionType}
                                  {c.connectionType === 'IDENTITY_ASSERTION_CUSTOM_AS' && (
                                    <span> · {c.selectedScopes && c.selectedScopes.length > 0 ? `${c.selectedScopes.length} scope${c.selectedScopes.length > 1 ? 's' : ''}` : 'All scopes'}</span>
                                  )}
                                </div>
                              </div>
                              <button onClick={() => toggleConnection(c)} className="text-slate-500 hover:text-red-400 flex-shrink-0"><X className="w-4 h-4" /></button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Step A: pick category */}
                  {resourceStep === 'type' && (
                    <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-white">Select a resource type</h3>
                        <button onClick={() => setResourceStep('closed')} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>
                      {loadingResources ? (
                        <div className="text-xs text-slate-500 text-center py-6">
                          <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Loading…
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {RESOURCE_TYPES.map((type) => {
                            const Icon = type.icon;
                            const infoOnly = 'infoOnly' in type && type.infoOnly;
                            const available = resources.filter((r) => (type.connectionTypes as readonly string[]).includes(r.connectionType)).length;
                            return (
                              <button
                                key={type.id}
                                onClick={() => infoOnly ? setShowServiceAccountInfo(true) : setResourceStep(type.id)}
                                className="w-full flex items-center gap-3 px-3 py-3 bg-[#111827] border border-[#1e293b] hover:border-[#1662dd]/40 rounded-lg text-left transition-colors"
                              >
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${type.colour}1a` }}>
                                  <Icon className="w-3.5 h-3.5" style={{ color: type.colour }} />
                                </div>
                                <span className="text-sm font-semibold text-white flex-1">{type.label}</span>
                                <span className="text-xs text-[#60a5fa] font-medium">
                                  {infoOnly ? 'Learn more' : available > 0 ? `${available} available` : 'None yet'}
                                </span>
                                <ChevronRight className="w-4 h-4 text-slate-500" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step B: pick specific resource within category */}
                  {selectedType && (
                    <div className="bg-[#0a0f1e] border border-[#1e293b] rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <button onClick={() => setResourceStep('type')} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white">
                          <ArrowLeft className="w-3.5 h-3.5" /> Back
                        </button>
                        <h3 className="text-sm font-semibold text-white flex-1">{selectedType.label}</h3>
                        <button onClick={() => setResourceStep('closed')} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>
                      {filteredForType.length === 0 ? (
                        <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-[#1e293b] rounded-lg">
                          No {selectedType.label.toLowerCase()} resources available yet
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                          {filteredForType.map((item) => {
                            const orn = connectionOrn(item);
                            const checked = selectedOrns.has(orn);
                            const isPending = pendingAuthServerOrn === orn;
                            return (
                              <div key={orn}>
                                <button
                                  onClick={() => selectedType.id === 'auth_server'
                                    ? setPendingAuthServerOrn(isPending ? null : orn)
                                    : toggleConnection(item)}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${checked || isPending ? 'border-[#1662dd]/40 bg-[#1662dd]/5' : 'border-[#1e293b] bg-[#111827] hover:border-[#1662dd]/30'}`}
                                >
                                  <span className="text-sm text-white flex-1">{connectionName(item)}</span>
                                  {checked && <Check className="w-4 h-4 text-[#60a5fa] flex-shrink-0" />}
                                </button>
                                {isPending && item.authorizationServer?.orn && (
                                  <div className="mt-2 p-3 bg-[#111827] border border-[#1e293b] rounded-lg space-y-3">
                                    <ScopeSelector
                                      agentId="pending"
                                      authServerOrn={item.authorizationServer.orn}
                                      onChange={setPendingScopes}
                                    />
                                    <button
                                      onClick={() => { toggleConnection({ ...item, selectedScopes: pendingScopes }); setPendingAuthServerOrn(null); setPendingScopes(undefined); }}
                                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#1662dd] text-white rounded-lg hover:bg-blue-600 transition-colors"
                                    >
                                      <Plus className="w-3.5 h-3.5" /> Add
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Review */}
              {step === 4 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">Review & submit</h2>
                    <p className="text-sm text-slate-400">Confirm the details before Okta provisions this agent.</p>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3 py-2 border-b border-[#1e293b]">
                      <Bot className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-white">{name}</div>
                        {description && <div className="text-xs text-slate-400 mt-0.5">{description}</div>}
                        <div className="text-[11px] text-slate-500 mt-1">
                          Will appear in Okta as <span className="font-mono">[Agent Request] {name}</span> — a visible marker so this request is easy to find and clean up later.
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 py-2 border-b border-[#1e293b]">
                      <UserCheck className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-400">Owner:</span>
                      <span className="font-medium text-white">{owner?.displayName}</span>
                    </div>
                    <div className="flex items-start gap-3 py-2 border-b border-[#1e293b]">
                      <UserCheck className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-slate-400">Sign-in access: </span>
                        <span className="font-medium text-white">
                          {userAccess
                            ? [...signInUsers.map((u) => u.displayName), ...signInGroups.map((g) => `${g.name} (group)`)].join(', ') || `${owner?.displayName} (default)`
                            : 'Not enabled'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 py-2 border-b border-[#1e293b]">
                      <Cpu className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <span className="text-slate-400">Machine callers: </span>
                        <span className="font-medium text-white">
                          {machineAccess ? (callerAgents.length > 0 ? callerAgents.map((a) => a.name).join(', ') : 'None yet') : 'Not enabled'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 py-2 border-b border-[#1e293b]">
                      <Key className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-400">Credentials:</span>
                      <span className="font-medium text-white">{credentialType === 'private_key_jwt' ? 'Public / private key' : 'Client secret'}</span>
                    </div>
                    <div className="flex items-center gap-3 py-2">
                      <Server className="w-4 h-4 text-slate-500 flex-shrink-0" />
                      <span className="text-slate-400">Resources:</span>
                      <span className="font-medium text-white">{selectedConnections.length || 'None'}</span>
                    </div>
                  </div>
                  {submitError && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{submitError}</div>}
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-5 border-t border-[#1e293b]">
                <button
                  onClick={() => setStep((s) => (s > 0 ? ((s - 1) as Step) : s))}
                  disabled={step === 0}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                {step < 4 ? (
                  <button
                    onClick={() => { setResourceStep('closed'); setStep((s) => ((s + 1) as Step)); }}
                    disabled={!canAdvance}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    Next <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={submitting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#1662dd] hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                    {submitting ? 'Submitting…' : 'Submit Request'}
                  </button>
                )}
              </div>
            </div>

            {showServiceAccountInfo && <ServiceAccountInfoModal onClose={() => setShowServiceAccountInfo(false)} />}
          </div>
        )}
      </div>

      <ProvisioningPanel />
    </div>
  );
}
