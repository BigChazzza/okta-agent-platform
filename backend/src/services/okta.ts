// Okta Management API + AI Agents (Secures AI / Workload Principals) API
// All calls use SSWS API token — simpler, no OAuth2 M2M needed.

const ORG = () => process.env.OKTA_ORG_URL!;
const TOKEN = () => process.env.OKTA_API_TOKEN!;

async function sswsFetch(path: string, init: RequestInit = {}) {
  return fetch(`${ORG()}${path}`, {
    ...init,
    headers: {
      Authorization: `SSWS ${TOKEN()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
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
  // IDENTITY_ASSERTION_CUSTOM_AS / A2A_SERVER
  authorizationServer?: { name: string; issuerUrl: string; orn: string; _links?: any };
  resourceIndicator?: string;
  // STS_ACCESS_TOKEN / APP_INSTANCE
  resource?: {
    appInstanceId?: string; appInstanceName?: string;
    clientAuthSettings?: { name: string; orn: string };
    resourceType?: string; orn?: string; _links?: any;
  };
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
    case 'IDENTITY_ASSERTION_CUSTOM_AS':
    case 'IDENTITY_ASSERTION_A2A_SERVER':
      body = {
        connectionType: connection.connectionType,
        authorizationServer: { orn: connection.authorizationServer!.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      if (connection.resourceIndicator) body.resourceIndicator = connection.resourceIndicator;
      break;

    case 'IDENTITY_ASSERTION_APP_INSTANCE':
      body = {
        connectionType: connection.connectionType,
        appInstance: { orn: connection.resource?.orn },
        scopeCondition: 'ALL_SCOPES',
        scopes: ['*'],
      };
      break;

    case 'STS_ACCESS_TOKEN':
      body = {
        connectionType: connection.connectionType,
        resource: {
          appInstanceId: connection.resource?.appInstanceId,
          clientAuthSettings: { orn: connection.resource?.clientAuthSettings?.orn },
        },
      };
      break;

    default:
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { connectionType: _ct, ...rest } = connection as any;
      body = { connectionType: connection.connectionType, ...rest };
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
