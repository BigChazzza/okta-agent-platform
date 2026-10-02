// Okta Management API + AI Agents (Secures AI / Workload Principals) API
// All calls use SSWS API token — simpler, no OAuth2 M2M needed.

import { randomUUID } from 'crypto';
import { importPKCS8, SignJWT } from 'jose';
import { eventBus, nextId, labelForPath } from './eventBus';

const ORG = () => process.env.OKTA_ORG_URL!;
const TOKEN = () => process.env.OKTA_API_TOKEN!;

function maskSecrets(value: any): any {
  return JSON.parse(JSON.stringify(value, (k, v) =>
    ['client_secret', 'secret', 'password', 'token', 'Authorization'].includes(k) ? '***' : v
  ));
}

async function sswsFetch(path: string, init: RequestInit = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const startMs = Date.now();
  const eventId = nextId();

  // Parse request body for the event (mask sensitive fields)
  let requestBody: any;
  if (init.body && typeof init.body === 'string') {
    try {
      const parsed = JSON.parse(init.body);
      // Mask secret values
      requestBody = JSON.parse(JSON.stringify(parsed, (k, v) =>
        ['client_secret', 'secret', 'password', 'token', 'Authorization'].includes(k)
          ? '***' : v
      ));
    } catch { requestBody = '[binary]'; }
  }

  // Emit request-start event
  eventBus.emit('okta:call', {
    id: eventId,
    ts: new Date().toISOString(),
    method,
    path,
    label: labelForPath(method, path),
    requestBody,
  });

  const res = await fetch(`${ORG()}${path}`, {
    ...init,
    headers: {
      Authorization: `SSWS ${TOKEN()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  // Emit completion with status + duration
  eventBus.emit('okta:response', {
    id: eventId,
    ts: new Date().toISOString(),
    method,
    path,
    label: labelForPath(method, path),
    requestBody,
    status: res.status,
    durationMs: Date.now() - startMs,
  });

  return res;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface OktaUser {
  id: string; login: string; email: string;
  firstName: string; lastName: string; displayName: string; status: string;
}

export async function listUsers(query?: string, limit = 25): Promise<OktaUser[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const res = await sswsFetch(`/api/v1/users?${params}`);
  if (!res.ok) throw new Error(`listUsers ${res.status}: ${await res.text()}`);
  const users = await res.json() as any[];
  return users.map((u) => ({
    id: u.id, login: u.profile.login, email: u.profile.email,
    firstName: u.profile.firstName, lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  }));
}

export async function getUser(userId: string): Promise<OktaUser> {
  const res = await sswsFetch(`/api/v1/users/${userId}`);
  if (!res.ok) throw new Error(`getUser ${res.status}`);
  const u = await res.json() as any;
  return {
    id: u.id, login: u.profile.login, email: u.profile.email,
    firstName: u.profile.firstName, lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  };
}

// ── AI Agents (Secures AI / Workload Principals) ───────────────────────────────

export interface OktaAIAgent {
  id: string; platform: string; status: string; appId?: string;
  profile: { name: string; description?: string };
  created?: string; lastUpdated?: string; _links?: any;
  signOnProvider?: { type?: string; appInstanceId?: string };
}

async function pollOperation(opUrl: string, maxAttempts = 15): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(opUrl, {
      headers: { Authorization: `SSWS ${TOKEN()}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Operation poll failed: ${res.status}`);
    const op = await res.json() as any;
    if (op.status === 'COMPLETED') return op.resource?.id;
    if (op.status === 'FAILED') throw new Error(`Agent operation failed: ${JSON.stringify(op)}`);
  }
  throw new Error('Agent creation timed out');
}

export async function listAIAgents(limit = 50): Promise<OktaAIAgent[]> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents?limit=${limit}&orderBy=createdDate&sortOrder=desc`);
  if (!res.ok) throw new Error(`listAIAgents ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: OktaAIAgent[] };
  return data.data || [];
}

export async function createAIAgent(name: string, description?: string): Promise<OktaAIAgent> {
  const body: any = { profile: { name } };
  if (description) body.profile.description = description;

  const res = await sswsFetch('/workload-principals/api/v1/ai-agents', {
    method: 'POST', body: JSON.stringify(body),
  });

  if (res.status === 202) {
    const opUrl = res.headers.get('Location');
    if (!opUrl) throw new Error('No Location header in 202 response');
    const agentId = await pollOperation(opUrl);
    return getAIAgent(agentId);
  }
  if (!res.ok) {
    const err = await res.json() as any;
    const causes = err.errorCauses || [];
    if (causes.some((c: any) => c.errorSummary?.includes('already exists'))) {
      throw new Error(`An agent named "${name}" already exists in Okta. Please choose a different name.`);
    }
    throw new Error(err.errorSummary || `createAIAgent ${res.status}`);
  }
  return res.json() as Promise<OktaAIAgent>;
}

export async function getAIAgent(agentId: string): Promise<OktaAIAgent> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`);
  if (!res.ok) throw new Error(`getAIAgent ${res.status}`);
  return res.json() as Promise<OktaAIAgent>;
}

export async function deleteAIAgent(agentId: string): Promise<void> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`, { method: 'DELETE' });
  if (res.status !== 204 && !res.ok) console.warn(`deleteAIAgent returned ${res.status}`);
}

export async function activateAIAgent(agentId: string): Promise<any> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/lifecycle/activate`, { method: 'POST' });
  if (res.status === 202) {
    // Async — poll for completion
    const opUrl = res.headers.get('Location');
    if (opUrl) {
      try { await pollOperation(opUrl, 20); } catch {}
    }
    // Re-fetch agent to get updated status + appId
    await new Promise(r => setTimeout(r, 2000));
    return getAIAgent(agentId);
  }
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `activateAgent ${res.status}`);
  }
  return res.json();
}

export async function deactivateAIAgent(agentId: string): Promise<void> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/lifecycle/deactivate`, { method: 'POST' });
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `deactivateAgent ${res.status}`);
  }
}

// ── Agent Credentials (backing app) ──────────────────────────────────────────

export interface AgentCredentials {
  appId: string; clientId: string; authMethod: string;
  clientSecret?: string; hasSecret?: boolean;
}

export async function getAgentCredentials(appId: string): Promise<AgentCredentials> {
  const res = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!res.ok) throw new Error(`getAgentCredentials ${res.status}`);
  const app = await res.json() as any;
  const creds = app.credentials?.oauthClient || {};
  return {
    appId,
    clientId: creds.client_id || appId,
    authMethod: creds.token_endpoint_auth_method || 'client_secret_basic',
    hasSecret: !!creds.client_secret,
  };
}

export async function setAgentAuthMethod(appId: string, authMethod: string): Promise<AgentCredentials> {
  // GET current app config then PUT it back with updated auth method
  const getRes = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!getRes.ok) throw new Error(`getApp ${getRes.status}`);
  const app = await getRes.json() as any;

  app.credentials = app.credentials || {};
  app.credentials.oauthClient = app.credentials.oauthClient || {};
  app.credentials.oauthClient.token_endpoint_auth_method = authMethod;

  const putRes = await sswsFetch(`/api/v1/apps/${appId}`, {
    method: 'PUT', body: JSON.stringify(app),
  });
  if (!putRes.ok) {
    const err = await putRes.json() as any;
    throw new Error(err.errorSummary || `setAuthMethod ${putRes.status}`);
  }
  const updated = await putRes.json() as any;
  const creds = updated.credentials?.oauthClient || {};
  return {
    appId,
    clientId: creds.client_id || appId,
    authMethod: creds.token_endpoint_auth_method,
    hasSecret: authMethod !== 'none' && authMethod !== 'private_key_jwt',
  };
}

// ── IGA Resource Owners ───────────────────────────────────────────────────────
// Governance API to assign owners in Okta's AI Agents "Owners" tab

export function agentOrnFromLinks(links: any): string {
  // Extract agent ORN from the delegationLinks href filter param.
  // The href's query string is URL-encoded (e.g. %20, %22), so decode
  // the whole string before matching the filter expression.
  const rawHref = links?.delegationLinks?.href || '';
  const href = decodeURIComponent(rawHref);
  const match = href.match(/to\.resourceOrn\s+eq\s+"([^"]+)"/);
  return match ? match[1] : '';
}

export async function getAgentAdminUrl(agentId: string): Promise<string> {
  // Build the Okta Admin Console deep-link for the agent's Owners tab
  const orgUrl = ORG();
  const adminUrl = orgUrl.replace('https://', 'https://').replace(/\.okta\.com$/, '-admin.okta.com').replace(/\.oktapreview\.com$/, '-admin.oktapreview.com');
  return `${adminUrl}/admin/ai-agent/${agentId}/edit#owners`;
}

export async function removeAgentOwner(agentId: string, userId: string): Promise<void> {
  // The IGA API supports REMOVE. Use it when revoking an owner.
  const agent = await getAIAgent(agentId);
  const agentOrn = agentOrnFromLinks(agent._links);
  if (!agentOrn) return;

  const parts = agentOrn.split(':');
  const env = parts[1]; const orgId = parts[3];
  const userOrn = `orn:${env}:directory:${orgId}:users:${userId}`;

  const res = await sswsFetch('/governance/api/v1/resource-owners', {
    method: 'PATCH',
    body: JSON.stringify({ resourceOrn: agentOrn, data: [{ op: 'REMOVE', path: '/principalOrn', value: userOrn }] }),
  });
  if (res.status !== 204 && !res.ok) {
    console.warn(`IGA REMOVE owner returned ${res.status}`);
  }
}

// Assigns (or replaces) the owner for an AI agent resource via the IGA
// Resource Owners API. POST replaces the full owner list for the resource,
// which is exactly the "set owner" semantics this app needs.
// https://developer.okta.com/docs/api/iga/openapi/governance-production-reference/resource-owners
export async function setAgentOwner(agentId: string, userId: string): Promise<void> {
  const agent = await getAIAgent(agentId);
  const agentOrn = agentOrnFromLinks(agent._links);
  if (!agentOrn) {
    throw new Error("Could not resolve this agent's resource ORN from Okta — it may need to be activated first.");
  }

  const parts = agentOrn.split(':');
  const env = parts[1]; const orgId = parts[3];
  const userOrn = `orn:${env}:directory:${orgId}:users:${userId}`;

  const res = await sswsFetch('/governance/api/v1/resource-owners', {
    method: 'POST',
    body: JSON.stringify({ resourceOrns: [agentOrn], principalOrns: [userOrn] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.errorSummary || err.error?.message || `setAgentOwner ${res.status}`);
  }
}

// ── Potential Connections (what can be connected to an agent) ─────────────────

export const CONNECTION_TYPES = [
  'IDENTITY_ASSERTION_CUSTOM_AS',
  'IDENTITY_ASSERTION_A2A_SERVER',
  'IDENTITY_ASSERTION_APP_INSTANCE',
  'STS_ACCESS_TOKEN',
  'STS_VAULT_SECRET',
  'STS_SERVICE_ACCOUNT',
  'IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER',
] as const;

export type ConnectionType = typeof CONNECTION_TYPES[number];

export interface PotentialConnection {
  connectionType: ConnectionType;
  // IDENTITY_ASSERTION_CUSTOM_AS / A2A_SERVER / APP_INSTANCE (optional AS)
  authorizationServer?: { name: string; issuerUrl: string; orn: string; _links?: any };
  resourceIndicator?: string;
  // A2A_SERVER — the other agent being connected to
  resource?: {
    // STS_ACCESS_TOKEN shape
    appInstanceId?: string; appInstanceName?: string;
    clientAuthSettings?: { name: string; orn: string };
    resourceType?: 'API_SERVER' | 'APP_INSTANCE' | 'MCP_SERVER';
    orn?: string; name?: string; _links?: any;
  };
  // APP_INSTANCE
  app?: { orn: string; name?: string; logo?: string; _links?: any };
  // STS_SERVICE_ACCOUNT
  serviceAccount?: { orn: string; name?: string; _links?: any };
  // STS_VAULT_SECRET
  secret?: { orn: string; name?: string; description?: string; _links?: any };
  // A2A_SERVER — the other agent's a2a resource
  a2aServer?: { orn: string; name?: string; _links?: any };
}

export async function listPotentialConnections(types?: ConnectionType[]): Promise<PotentialConnection[]> {
  const targetTypes = types || CONNECTION_TYPES;
  const results: PotentialConnection[] = [];

  await Promise.all(targetTypes.map(async (type) => {
    try {
      const filter = encodeURIComponent(`connectionType eq "${type}"`);
      const res = await sswsFetch(`/workload-principals/api/v1/potential-connections?filter=${filter}&limit=50`);
      if (!res.ok) return;
      const data = await res.json() as { data: any[] };
      if (data.data) results.push(...data.data);
    } catch {}
  }));

  return results;
}

// ── Agent Connections (what is currently connected) ───────────────────────────

export interface AgentConnection {
  id: string; connectionType: string; status: string; orn?: string;
  authorizationServer?: { name: string; issuerUrl: string; orn: string };
  resourceIndicator?: string; scopeCondition?: string; scopes?: string[];
  resource?: any; _links?: any;
}

export async function listAgentConnections(agentId: string): Promise<AgentConnection[]> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/connections`);
  if (!res.ok) return [];
  const data = await res.json() as any;
  return (data.data || data || []) as AgentConnection[];
}

export async function createAgentConnection(
  agentId: string,
  connection: PotentialConnection
): Promise<AgentConnection> {
  let body: any;

  switch (connection.connectionType) {
    // Identity assertion via a custom authorization server (resourceIndicator required)
    case 'IDENTITY_ASSERTION_CUSTOM_AS':
      body = {
        connectionType: connection.connectionType,
        authorizationServer: { orn: connection.authorizationServer!.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;

    // Agent-to-agent — connects to another agent's A2A resource, no scopes/scopeCondition
    case 'IDENTITY_ASSERTION_A2A_SERVER':
      body = {
        connectionType: connection.connectionType,
        a2aServer: { orn: connection.a2aServer?.orn || connection.resource?.orn },
        authorizationServer: { orn: connection.authorizationServer!.orn },
      };
      break;

    // App instance identity assertion — requires the AS issuerUrl, not just its ORN
    case 'IDENTITY_ASSERTION_APP_INSTANCE':
      body = {
        connectionType: connection.connectionType,
        app: { orn: connection.app?.orn || connection.resource?.orn },
        issuerUrl: connection.authorizationServer?.issuerUrl,
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;

    // Third-party app/MCP/API server access via STS — resource.orn is the client-auth-settings ORN
    case 'STS_ACCESS_TOKEN': {
      const r = connection.resource;
      body = {
        connectionType: connection.connectionType,
        resource: {
          resourceType: r?.resourceType,
          orn: r?.clientAuthSettings?.orn,
          ...(r?.resourceType === 'APP_INSTANCE'
            ? { appInstanceName: r?.appInstanceName }
            : { name: r?.name }),
        },
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;
    }

    case 'STS_VAULT_SECRET':
      body = {
        connectionType: connection.connectionType,
        secret: { orn: connection.secret?.orn },
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;

    case 'STS_SERVICE_ACCOUNT':
      body = {
        connectionType: connection.connectionType,
        app: { orn: connection.app?.orn },
        serviceAccount: { orn: connection.serviceAccount?.orn },
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;

    case 'IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER':
      throw new Error('Connecting MCP servers directly is not yet supported by the Okta AI Agents API.');

    default:
      throw new Error(`Unsupported connection type: ${connection.connectionType}`);
  }

  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}/connections`, {
    method: 'POST', body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `createConnection ${res.status}: ${JSON.stringify(err.errorCauses || [])}`);
  }

  const raw = await res.text();
  return raw ? JSON.parse(raw) : body;
}

export async function deleteAgentConnection(agentId: string, connectionId: string): Promise<void> {
  const res = await sswsFetch(
    `/workload-principals/api/v1/ai-agents/${agentId}/connections/${connectionId}`,
    { method: 'DELETE' }
  );
  if (res.status !== 204 && !res.ok) throw new Error(`deleteConnection ${res.status}`);
}

// ── User Access (agent's backing OIDC app) ────────────────────────────────────

async function patchAIAgent(agentId: string, body: any): Promise<void> {
  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`, {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/merge-patch+json' },
  });
  if (res.status === 202) {
    const opUrl = res.headers.get('Location');
    if (opUrl) await pollOperation(opUrl);
    return;
  }
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `patchAIAgent ${res.status}`);
  }
}

export async function enableUserAccess(agentId: string): Promise<void> {
  await patchAIAgent(agentId, { signOnProvider: { type: 'NEW_OIDC_APP' } });
}

export async function setAgentResourceUrl(agentId: string, resourceUrl: string): Promise<void> {
  await patchAIAgent(agentId, { resourceUrl });
}

// Okta creates the backing OIDC app INACTIVE — assigning a user to / logging into an inactive
// app fails with a misleading "AppInstance not found" 404. Re-activating an already active app
// is a no-op on Okta's side.
export async function activateApp(appId: string): Promise<void> {
  const res = await sswsFetch(`/api/v1/apps/${appId}/lifecycle/activate`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `activateApp ${res.status}`);
  }
}

// Orchestrates the streamlined flow: ensure the agent has a backing OIDC app, ensure it's
// active, and return its appId — ready for a real login test. Safe to call repeatedly; each
// step is a no-op if already done.
export async function ensureUserAccess(agentId: string): Promise<string> {
  let agent = await getAIAgent(agentId);
  if (!agent.signOnProvider?.appInstanceId) {
    await enableUserAccess(agentId);
    agent = await getAIAgent(agentId);
  }
  const appId = agent.signOnProvider?.appInstanceId;
  if (!appId) throw new Error('Failed to provision a backing app for this agent');
  await activateApp(appId);
  return appId;
}

// ── ORN helpers (Exercise / Machine Access) ───────────────────────────────────

export function orgIdFromAgentOrn(orn: string): string {
  // orn:<env>:directory:<orgId>:workload-principals:ai-agents:<id>
  return orn.split(':')[3];
}

export function buildAuthorizationServerOrn(authServerId: string, orgId: string): string {
  return `orn:oktapreview:idp:${orgId}:authorization_servers:${authServerId}`;
}

// A service app (OAuth Service application) authorized as a Machine Access caller — the same
// delegation-links endpoint used for agent-to-agent callers, but from.clientOrn points at the
// app itself rather than at an agent's workload-principal ORN.
export function buildAppOrn(appId: string, orgId: string): string {
  return `orn:oktapreview:idp:${orgId}:apps:oidc_client:${appId}`;
}

// An agent's own auto-created a2a resource server — the ORN a resource connection's `resource`
// field points at when the target is another AI agent.
export function buildA2AResourceOrn(agentId: string, orgId: string): string {
  return `orn:oktapreview:directory:${orgId}:resource-servers:a2a:${agentId}`;
}

export interface AppOption { id: string; label: string; applicationType?: string; }

// Search Okta OAuth apps by name — backs the "Service app" caller picker for Machine Access.
// Okta's Apps API has no server-side filter for application_type, so this fetches a larger batch
// and filters to real service clients client-side, excluding Okta's own built-in system apps.
export async function searchApps(query?: string, limit = 20): Promise<AppOption[]> {
  const params = new URLSearchParams({ limit: '200' });
  if (query) params.set('q', query);
  const res = await sswsFetch(`/api/v1/apps?${params}`);
  if (!res.ok) throw new Error(`searchApps ${res.status}: ${await res.text()}`);
  const apps = await res.json() as any[];
  return apps
    .filter((a) => a.settings?.oauthClient?.application_type === 'service')
    .slice(0, limit)
    .map((a) => ({ id: a.id, label: a.label, applicationType: a.settings?.oauthClient?.application_type }));
}

export async function getApp(appId: string): Promise<AppOption> {
  const res = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!res.ok) throw new Error(`getApp ${res.status}`);
  const a = await res.json() as any;
  return { id: a.id, label: a.label, applicationType: a.settings?.oauthClient?.application_type };
}

export interface AuthorizationServer { id: string; name: string; orn: string; }

export async function listAuthorizationServers(orgId: string): Promise<AuthorizationServer[]> {
  const res = await sswsFetch('/api/v1/authorizationServers');
  if (!res.ok) throw new Error(`listAuthorizationServers ${res.status}: ${await res.text()}`);
  const servers = await res.json() as any[];
  return servers.map((s) => ({ id: s.id, name: s.name, orn: buildAuthorizationServerOrn(s.id, orgId) }));
}

// Surfaces the real issuer URL — needed to build a token endpoint for the Exercise feature.
export async function getAuthorizationServer(authServerId: string): Promise<{ id: string; name: string; issuer: string }> {
  const res = await sswsFetch(`/api/v1/authorizationServers/${authServerId}`);
  if (!res.ok) throw new Error(`getAuthorizationServer ${res.status}: ${await res.text()}`);
  const s = await res.json() as any;
  return { id: s.id, name: s.name, issuer: s.issuer };
}

// The agent's own /ai-agents/{id} response never includes resourceUrl — it only shows up on the
// auto-created a2a resource server once set (and can't be changed after that point).
export async function getAgentResourceUrl(agentId: string): Promise<string | undefined> {
  const res = await sswsFetch(`/resource-servers/api/v1/a2a-servers/${agentId}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`getAgentResourceUrl ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  return data.resourceUrl;
}

export async function connectAuthorizationServer(agentId: string, authServerOrn: string): Promise<void> {
  const res = await sswsFetch(`/resource-servers/api/v1/a2a-servers/${agentId}/authorization-servers`, {
    method: 'POST', body: JSON.stringify({ orn: authServerOrn, type: 'OKTA' }),
  });
  if (res.status !== 204 && !res.ok) {
    const err = await res.json() as any;
    throw new Error(err.errorSummary || `connectAuthorizationServer ${res.status}`);
  }
}

// Orchestrates the streamlined Machine Access flow: ensure the target agent has an audience/
// resource URL (computing one from its own agent ID if it doesn't have one yet — Okta won't let
// an existing value be changed, so this is a no-op when already set), connect the given shared
// authorization server to it, and return both ORNs ready for createDelegationLink.
export async function ensureMachineAccess(agentId: string, authServerId: string): Promise<{ targetOrn: string; authServerOrn: string }> {
  const agent = await getAIAgent(agentId);
  const targetOrn = agentOrnFromLinks(agent._links);
  if (!targetOrn) throw new Error('Could not resolve agent ORN — agent may not be fully provisioned yet');

  const existingResourceUrl = await getAgentResourceUrl(agentId);
  if (!existingResourceUrl) {
    await setAgentResourceUrl(agentId, `https://${agentId}`);
  }

  const orgId = orgIdFromAgentOrn(targetOrn);
  const authServerOrn = buildAuthorizationServerOrn(authServerId, orgId);
  await connectAuthorizationServer(agentId, authServerOrn);

  return { targetOrn, authServerOrn };
}

export async function createDelegationLink(callerOrn: string, targetOrn: string, authServerOrn: string): Promise<void> {
  // Newly-connected authorization servers (connectAuthorizationServer) can take a moment to
  // propagate before delegation-links accepts them — retry briefly on that specific validation error.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await sswsFetch('/workload-principals/api/v1/delegation-links', {
      method: 'POST',
      body: JSON.stringify({
        from: { type: 'OKTA_AUTHORIZATION_SERVER', clientOrn: callerOrn, tokenType: 'ACCESS_TOKEN' },
        to: { resourceOrn: targetOrn, authorizationServerOrn: authServerOrn },
      }),
    });
    if (res.ok) return;

    const err = await res.json() as any;
    // Already linked — treat as success so callers (e.g. the reciprocal auto-link from
    // ensureAgentConnection) can call this unconditionally without needing to check first.
    const alreadyExists = err.errorCauses?.some((c: any) => c.reason === 'UNIQUE_CONSTRAINT');
    if (alreadyExists) return;

    const isPropagationDelay = err.errorCauses?.some((c: any) => c.location === 'to.authorizationServerOrn');
    if (isPropagationDelay && attempt < 4) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(err.errorSummary || `createDelegationLink ${res.status}`);
  }
}

export interface DelegationLink { id: string; callerOrn: string; authorizationServerOrn: string; }

export async function listDelegationLinksTo(targetOrn: string): Promise<DelegationLink[]> {
  const filter = encodeURIComponent(`to.resourceOrn eq "${targetOrn}"`);
  const res = await sswsFetch(`/workload-principals/api/v1/delegation-links?filter=${filter}&limit=20`);
  if (!res.ok) throw new Error(`listDelegationLinksTo ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: any[] };
  return (data.data || []).map((d) => ({
    id: d.id,
    callerOrn: d.from?.clientOrn || '',
    authorizationServerOrn: d.to?.authorizationServerOrn || '',
  }));
}

export interface DelegationLinkFrom { id: string; targetOrn: string; authorizationServerOrn: string; }

// Reverse lookup: given a caller's ORN, which targets is it authorized to call? Used by the
// Exercise page's caller-first flow (pick the caller agent, then only show targets it can reach).
export async function listDelegationLinksFrom(callerOrn: string): Promise<DelegationLinkFrom[]> {
  const filter = encodeURIComponent(`from.clientOrn eq "${callerOrn}"`);
  const res = await sswsFetch(`/workload-principals/api/v1/delegation-links?filter=${filter}&limit=20`);
  if (!res.ok) throw new Error(`listDelegationLinksFrom ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: any[] };
  return (data.data || []).map((d) => ({
    id: d.id,
    targetOrn: d.to?.resourceOrn || '',
    authorizationServerOrn: d.to?.authorizationServerOrn || '',
  }));
}

// Auto-creates the reciprocal resource connection for a caller→target Machine Access
// authorization, matching the real Okta Admin Console's behavior of keeping the delegation link
// and the resource connection in sync in both directions. Posted directly (rather than through
// createAgentConnection) so the structured errorCauses survive intact — needed to treat an
// already-connected pairing as a no-op rather than an error.
// NOTE: this body shape (and the a2a connectionType in general) is unverified against our live
// tenant — our own createAgentConnection's IDENTITY_ASSERTION_A2A_SERVER branch uses a different
// shape, and an earlier stashed WIP found A2A connections rejected by Okta entirely. Verify live
// before relying on this; adjust the body shape if Okta rejects it.
export async function ensureAgentConnection(callerAgentId: string, targetOrn: string, authServerOrn: string): Promise<void> {
  const targetAgentId = targetOrn.split(':').pop();
  if (!targetAgentId) throw new Error('Could not resolve target agent id from ORN');
  const orgId = orgIdFromAgentOrn(targetOrn);
  const targetResourceOrn = buildA2AResourceOrn(targetAgentId, orgId);

  const res = await sswsFetch(`/workload-principals/api/v1/ai-agents/${callerAgentId}/connections`, {
    method: 'POST',
    body: JSON.stringify({
      connectionType: 'IDENTITY_ASSERTION_A2A_SERVER',
      authorizationServer: { orn: authServerOrn },
      resource: { orn: targetResourceOrn },
      scopeCondition: 'ALL_SCOPES',
      scopes: ['*'],
    }),
  });
  if (res.ok) return;

  const err = await res.json() as any;
  const alreadyExists = err.errorCauses?.some((c: any) => c.reason === 'DUPLICATE_CONNECTION');
  if (alreadyExists) return;
  throw new Error(err.errorSummary || `ensureAgentConnection ${res.status}`);
}

// Prepares an agent's backing OIDC app for a real Exercise Agent test login: workload-principal-
// backed apps reject token_endpoint_auth_method 'none' outright, so this forces client_secret_basic
// instead and appends the given callback URL to its redirect_uris (appending, not overwriting, in
// case an admin already configured others). Returns the app's real client_id and secret so the
// backend can complete the code exchange server-side with Basic auth.
// This app IS the agent's own native OAuth client for User-Access-enabled agents, so forcing
// client_secret_basic here would silently downgrade a private_key_jwt agent's real production
// credential — only forced when the app isn't already on private_key_jwt; when it is, that's
// preserved (Okta requires jwks be present on any PUT while private_key_jwt is set).
export async function setAppAuthMethodAndRedirect(appId: string, redirectUri: string): Promise<{ clientId: string; clientSecret?: string; authMethod: string }> {
  const getRes = await sswsFetch(`/api/v1/apps/${appId}`);
  if (!getRes.ok) throw new Error(`getApp ${getRes.status}`);
  const app = await getRes.json() as any;

  app.credentials = app.credentials || {};
  app.credentials.oauthClient = app.credentials.oauthClient || {};
  const currentAuthMethod = app.credentials.oauthClient.token_endpoint_auth_method;

  app.settings = app.settings || {};
  app.settings.oauthClient = app.settings.oauthClient || {};

  let hasJwks = false;
  if (currentAuthMethod === 'private_key_jwt') {
    const jwksRes = await sswsFetch(`/api/v1/apps/${appId}/credentials/jwks`);
    if (jwksRes.ok) {
      const { keys } = await jwksRes.json() as any;
      if (Array.isArray(keys) && keys.length > 0) {
        app.settings.oauthClient.jwks = { keys: keys.map((k: any) => ({ kty: k.kty, kid: k.kid, use: k.use, alg: k.alg, e: k.e, n: k.n })) };
        hasJwks = true;
      }
    }
  }
  // Fall back to client_secret_basic whenever the app isn't actually on a usable private_key_jwt
  // configuration yet (e.g. a freshly-created backing app with no JWKS registered) — Okta
  // requires jwks be present on any PUT while private_key_jwt is set, so there's no key material
  // to preserve in that case anyway.
  if (currentAuthMethod !== 'private_key_jwt' || !hasJwks) {
    app.credentials.oauthClient.token_endpoint_auth_method = 'client_secret_basic';
    delete app.credentials.oauthClient.pkce_required;
  }

  const existingRedirects: string[] = app.settings.oauthClient.redirect_uris || [];
  if (!existingRedirects.includes(redirectUri)) {
    app.settings.oauthClient.redirect_uris = [...existingRedirects, redirectUri];
  }
  // Workload-principal-backed OAuth clients require token-exchange and jwt-bearer to stay in
  // grant_types (Okta rejects a PUT that drops them) — append authorization_code, don't replace.
  const existingResponseTypes: string[] = app.settings.oauthClient.response_types || [];
  if (!existingResponseTypes.includes('code')) {
    app.settings.oauthClient.response_types = [...existingResponseTypes, 'code'];
  }
  const existingGrantTypes: string[] = app.settings.oauthClient.grant_types || [];
  if (!existingGrantTypes.includes('authorization_code')) {
    app.settings.oauthClient.grant_types = [...existingGrantTypes, 'authorization_code'];
  }

  const putRes = await sswsFetch(`/api/v1/apps/${appId}`, { method: 'PUT', body: JSON.stringify(app) });
  if (!putRes.ok) {
    const err = await putRes.json() as any;
    const causes = (err.errorCauses || []).map((c: any) => c.errorSummary).join('; ');
    throw new Error(causes || err.errorSummary || `setAppAuthMethodAndRedirect ${putRes.status}`);
  }
  const updated = await putRes.json() as any;
  return {
    clientId: updated.credentials?.oauthClient?.client_id || appId,
    clientSecret: updated.credentials?.oauthClient?.client_secret,
    authMethod: updated.credentials?.oauthClient?.token_endpoint_auth_method,
  };
}

// ── Exercise Agent: real 3-step delegation chain made against onboarded agents ────────────────
// Unlike sswsFetch, these authenticate with the service client's or the caller agent's own
// credentials (not the backend's OKTA_API_TOKEN) against a custom authorization server's token
// endpoint. Still emitted on the event bus so they show up in API Events.

export function decodeJwt(token: string): { header: any; payload: any } {
  const [headerB64, payloadB64] = token.split('.');
  const decode = (b64: string) => JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { header: decode(headerB64), payload: decode(payloadB64) };
}

export interface ExerciseTokenResult {
  ok: boolean;
  status: number;
  accessToken?: string;
  decoded?: { header: any; payload: any };
  raw: any;
  request?: { tokenEndpoint: string; body: any };
}

// Generic client assertion signer, parameterized by an arbitrary key/kid/clientId so it can sign
// on behalf of any exercised agent using a stored test private key.
async function signAssertion(clientId: string, privateKeyPem: string, kid: string, audience: string): Promise<string> {
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

export interface AgentTestCredential {
  clientSecret?: string;
  privateKeyPem?: string;
  privateKeyKid?: string;
}

// Shared low-level POST to a token endpoint, authenticating either via Basic auth (client_secret)
// or a signed client_assertion (private_key_jwt) depending on which credential is supplied.
// Emits on the event bus so every hop of the chain shows up in the Okta API Events panel.
export async function postToken(
  tokenEndpoint: string, clientId: string, cred: AgentTestCredential, params: Record<string, string>, label: string
): Promise<ExerciseTokenResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  const body: Record<string, string> = { ...params };

  if (cred.privateKeyPem && cred.privateKeyKid) {
    body.client_assertion_type = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
    body.client_assertion = await signAssertion(clientId, cred.privateKeyPem, cred.privateKeyKid, tokenEndpoint);
  } else if (cred.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${cred.clientSecret}`).toString('base64')}`;
  }

  const eventId = nextId();
  const startMs = Date.now();
  eventBus.emit('okta:call', { id: eventId, ts: new Date().toISOString(), method: 'POST', path: tokenEndpoint, label, requestBody: maskSecrets(body) });

  const res = await fetch(tokenEndpoint, { method: 'POST', headers, body: new URLSearchParams(body) });
  const text = await res.text();
  let responseBody: any;
  try { responseBody = JSON.parse(text); } catch { responseBody = text; }

  eventBus.emit('okta:response', {
    id: eventId, ts: new Date().toISOString(), method: 'POST', path: tokenEndpoint, label,
    requestBody: maskSecrets(body), responseBody: maskSecrets(responseBody), status: res.status, durationMs: Date.now() - startMs,
  });

  const request = { tokenEndpoint, body: maskSecrets(body) };
  if (!res.ok) return { ok: false, status: res.status, raw: responseBody, request };
  const accessToken = responseBody.access_token;
  return { ok: true, status: res.status, accessToken, decoded: accessToken ? decodeJwt(accessToken) : undefined, raw: maskSecrets(responseBody), request };
}

// Step 1: the configured service client originates the chain with a plain client_credentials grant.
export async function runServiceClientGrant(
  tokenEndpoint: string, serviceClientId: string, serviceClientSecret: string, resource: string
): Promise<ExerciseTokenResult> {
  return postToken(
    tokenEndpoint, serviceClientId, { clientSecret: serviceClientSecret },
    { grant_type: 'client_credentials', scope: 'agent.invoke', resource },
    'Exercise: Service Client Grant'
  );
}

// Step 2: the caller agent exchanges the service client's access token for an id-jag, authenticating
// with whichever credential is actually configured for it. This hop targets the ORG-LEVEL default
// token endpoint (not the custom authorization server's own endpoint) and requires an explicit
// `audience` naming that authorization server's issuer. `resource` is required for an A2A hop
// (identifies the target agent) but must be OMITTED for a plain Custom Authorization Server hop.
export async function runIdJagExchange(
  orgTokenEndpoint: string, callerAgentId: string, callerCred: AgentTestCredential, subjectToken: string, resource: string | undefined, audience: string,
  subjectTokenType: string = 'urn:ietf:params:oauth:token-type:access_token',
  scope: string = 'agent.invoke'
): Promise<ExerciseTokenResult> {
  const params: Record<string, string> = {
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: subjectToken,
    subject_token_type: subjectTokenType,
    requested_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
    audience,
    scope,
  };
  if (resource) params.resource = resource;
  return postToken(orgTokenEndpoint, callerAgentId, callerCred, params, 'Exercise: Token Exchange (id-jag)');
}

// Step 3: the caller agent redeems the id-jag for the final delegated access token via a JWT-bearer
// grant, authenticating the same way it did for the exchange in step 2.
export async function runJwtBearerRedemption(
  tokenEndpoint: string, callerAgentId: string, callerCred: AgentTestCredential, idJag: string
): Promise<ExerciseTokenResult> {
  return postToken(
    tokenEndpoint, callerAgentId, callerCred,
    { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: idJag },
    'Exercise: JWT Bearer Redemption'
  );
}

// ── System Log (Logging page) ──────────────────────────────────────────────────

export interface OktaLogEvent {
  uuid: string; published: string; eventType: string; displayMessage: string;
  outcome: { result: string; reason?: string };
  actor: { id: string; type: string; displayName?: string; alternateId?: string };
  target?: { id: string; type: string; displayName?: string }[];
  debugContext?: { debugData?: Record<string, any> };
  transaction?: { id: string };
}

// Org-wide (not agent-scoped) — every OAuth2 grant/authorize event in the time range, paginated
// via the response's own Link header (a 24h window can exceed the 1000-per-page cap). sswsFetch
// always resolves its `path` against ORG(), so the next-page URL from the Link header (which is
// already a full URL) has its origin stripped before being re-passed in as a path.
export async function getOAuthSystemLogs(sinceIso: string, untilIso: string): Promise<OktaLogEvent[]> {
  const all: OktaLogEvent[] = [];
  let path: string | undefined = `/api/v1/logs?${new URLSearchParams({
    since: sinceIso, until: untilIso, filter: 'eventType sw "app.oauth2."', limit: '1000', sortOrder: 'ASCENDING',
  })}`;
  for (let page = 0; page < 10 && path; page++) {
    const res = await sswsFetch(path);
    if (!res.ok) break;
    all.push(...(await res.json() as OktaLogEvent[]));
    const nextUrl = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    path = nextUrl ? nextUrl.replace(ORG(), '') : undefined;
  }
  return all;
}

export interface LogHop {
  eventType: string; published: string; outcome: string; reason?: string;
  actorId: string; actorType: string; actorDisplayName?: string;
  issuedTokenId?: string; issuedTokenType?: 'access_token' | 'id_jag' | 'id_token';
  subjectTokenId?: string;
  resourceType?: string; resourceName?: string;
  requestId?: string;
  raw: OktaLogEvent;
}
export interface LogInteraction {
  rootTokenId: string; hops: LogHop[]; startedAt: string;
  actorIds: Set<string>;
}

const ISSUED_TOKEN_TYPES = ['access_token', 'id_jag', 'id_token'];

// Groups flat System Log events into end-to-end interaction chains by following Okta's own
// token-lineage pointers: a grant event's target[] names the token/id-jag/id_token it just
// issued, and a consuming event's debugContext.debugData.subjectTokenId names the exact upstream
// token it presented.
//
// Token lineage is a TREE (a token can fan out — e.g. one cached access token gets exchanged more
// than once within its TTL), not a set of disjoint groups — union-find is wrong here since it
// would merge every unrelated branch that ever consumed the same reused token into one blob.
// Enumerating every distinct root-to-leaf path instead yields one interaction per actual
// end-to-end call, even when several interactions share the same opening hop(s).
export function clusterLogInteractions(events: OktaLogEvent[]): LogInteraction[] {
  const hops: LogHop[] = events
    .filter(e => e.eventType.startsWith('app.oauth2.') && (e.eventType.includes('grant') || e.eventType === 'app.oauth2.authorize'))
    .map(e => {
      // target[] lists both the consumed (subject) and produced (issued) token on an exchange/
      // redemption event, with no type-priority order — the ISSUED token is the LAST entry in
      // practice (the only exceptions are refresh_token grants and unrelated consent-grant
      // events, neither part of this lineage). subjectTokenId in debugData is the authoritative
      // subject when present (token-exchange events set it); jwt-bearer redemptions don't set it
      // at all, so fall back to the issued-token-typed entry appearing BEFORE the last element —
      // that's exactly the id_jag/access_token that hop's own token-exchange step produced.
      const target = e.target || [];
      const issued = ISSUED_TOKEN_TYPES.includes(target[target.length - 1]?.type) ? target[target.length - 1] : undefined;
      const dd = e.debugContext?.debugData;
      const subjectTokenId = dd?.subjectTokenId
        || target.slice(0, -1).find(t => ISSUED_TOKEN_TYPES.includes(t.type))?.id;
      return {
        eventType: e.eventType, published: e.published, outcome: e.outcome.result, reason: e.outcome.reason,
        actorId: e.actor.id, actorType: e.actor.type, actorDisplayName: e.actor.displayName,
        issuedTokenId: issued?.id, issuedTokenType: issued?.type as LogHop['issuedTokenType'],
        subjectTokenId,
        resourceType: dd?.resourceType,
        resourceName: dd?.authorizationServerName || dd?.resource,
        requestId: dd?.requestId as string | undefined,
        raw: e,
      };
    });

  const issuedTokenIds = new Set(hops.filter(h => h.issuedTokenId).map(h => h.issuedTokenId!));
  const childrenByToken = new Map<string, LogHop[]>();
  for (const h of hops) {
    if (!h.subjectTokenId) continue;
    if (!childrenByToken.has(h.subjectTokenId)) childrenByToken.set(h.subjectTokenId, []);
    childrenByToken.get(h.subjectTokenId)!.push(h);
  }

  // An authorization_code redemption issues an id_token AND an access_token in the same request
  // (same requestId) — only the id_token is ever consumed downstream (by a token-exchange); the
  // sibling access_token grant is real but genuinely never used again, with no subjectTokenId/
  // children of its own, so it would otherwise become its own disconnected 1-hop "interaction".
  // Since both grants share the same actor and requestId, fold the unused sibling into the SAME
  // hop-list position as the one that does lead somewhere, rather than showing it as a separate row.
  const byRequestId = new Map<string, LogHop[]>();
  for (const h of hops) {
    if (!h.requestId) continue;
    if (!byRequestId.has(h.requestId)) byRequestId.set(h.requestId, []);
    byRequestId.get(h.requestId)!.push(h);
  }
  const attachedHops = new Map<LogHop, LogHop[]>(); // host hop -> sibling hops to fold in alongside it
  const attachedSet = new Set<LogHop>();
  for (const group of byRequestId.values()) {
    if (group.length < 2) continue;
    const withChildren = group.filter(h => h.issuedTokenId && childrenByToken.has(h.issuedTokenId));
    const dangling = group.filter(h => !h.subjectTokenId && !(h.issuedTokenId && childrenByToken.has(h.issuedTokenId)));
    if (withChildren.length === 1 && dangling.length > 0) {
      attachedHops.set(withChildren[0], dangling);
      for (const h of dangling) attachedSet.add(h);
    }
  }

  // A root is a hop with no subjectTokenId, or one whose subjectTokenId's own grant wasn't
  // captured in this time range (the chain started before the window) — either way, nothing in
  // this fetch can be its parent, so it begins its own interaction. Hops folded into a sibling
  // above are excluded here so they don't also form their own separate root.
  const roots = hops.filter(h => (!h.subjectTokenId || !issuedTokenIds.has(h.subjectTokenId)) && !attachedSet.has(h));

  const interactions: LogInteraction[] = [];
  function walk(path: LogHop[], hop: LogHop, visitedTokens: Set<string>) {
    const nextPath = [...path, hop, ...(attachedHops.get(hop) || [])];
    const children = hop.issuedTokenId ? childrenByToken.get(hop.issuedTokenId) : undefined;
    // visitedTokens guards against a malformed/cyclic lineage looping forever — real token ids are
    // unique per grant, so this should never trigger in practice.
    if (!children?.length || (hop.issuedTokenId && visitedTokens.has(hop.issuedTokenId))) {
      interactions.push({
        rootTokenId: nextPath[0].issuedTokenId || nextPath[0].raw.uuid, hops: nextPath, startedAt: nextPath[0].published,
        actorIds: new Set(nextPath.map(h => h.actorId)),
      });
      return;
    }
    const nextVisited = hop.issuedTokenId ? new Set(visitedTokens).add(hop.issuedTokenId) : visitedTokens;
    for (const child of children) walk(nextPath, child, nextVisited);
  }
  for (const root of roots) walk([], root, new Set());

  return interactions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
