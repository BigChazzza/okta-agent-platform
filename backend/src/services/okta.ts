// Okta Management API + AI Agents (Secures AI) API service

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const orgUrl = process.env.OKTA_ORG_URL!;
  const clientId = process.env.OKTA_M2M_CLIENT_ID!;
  const clientSecret = process.env.OKTA_M2M_CLIENT_SECRET!;
  const res = await fetch(`${orgUrl}/oauth2/v1/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'okta.users.read okta.apps.manage okta.groups.read',
    }),
  });
  if (!res.ok) throw new Error(`Okta token error: ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function oktaFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  return fetch(`${process.env.OKTA_ORG_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
  });
}

// ── Management API ─────────────────────────────────────────────────────────────

export interface OktaUser {
  id: string; login: string; email: string;
  firstName: string; lastName: string; displayName: string; status: string;
}

export async function listUsers(query?: string, limit = 25): Promise<OktaUser[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const res = await oktaFetch(`/api/v1/users?${params}`);
  if (!res.ok) throw new Error(`listUsers ${res.status}`);
  const users = await res.json() as any[];
  return users.map((u) => ({
    id: u.id, login: u.profile.login, email: u.profile.email,
    firstName: u.profile.firstName, lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  }));
}

export async function getUser(userId: string): Promise<OktaUser> {
  const res = await oktaFetch(`/api/v1/users/${userId}`);
  if (!res.ok) throw new Error(`getUser ${res.status}`);
  const u = await res.json() as any;
  return {
    id: u.id, login: u.profile.login, email: u.profile.email,
    firstName: u.profile.firstName, lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  };
}

// ── AI Agents API (Secures AI / Workload Principals) ──────────────────────────
// Base path: /workload-principals/api/v1/ai-agents
// Auth: SSWS API token (Management API token)
// POST returns 202 + Location header pointing to async operation
// Poll operation until COMPLETED, then GET the agent

const SSWS_TOKEN = process.env.OKTA_API_TOKEN || '';
const ORG_URL = () => process.env.OKTA_ORG_URL!;

async function aiAgentsFetch(path: string, init: RequestInit = {}) {
  // AI Agents API uses SSWS token, not OAuth
  const token = process.env.OKTA_API_TOKEN!;
  return fetch(`${ORG_URL()}${path}`, {
    ...init,
    headers: {
      Authorization: `SSWS ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  });
}

async function pollOperation(opUrl: string, maxAttempts = 10): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(opUrl, {
      headers: { Authorization: `SSWS ${process.env.OKTA_API_TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Operation poll failed: ${res.status}`);
    const op = await res.json() as any;
    if (op.status === 'COMPLETED' || op.status === 'SUCCEEDED') {
      return op.resource?.id;
    }
    if (op.status === 'FAILED' || op.status === 'ERROR') {
      throw new Error(`Agent operation failed: ${JSON.stringify(op)}`);
    }
  }
  throw new Error('Agent creation timed out');
}

export interface OktaAIAgent {
  id: string; platform: string; status: string;
  profile: { name: string; description?: string };
  created?: string; lastUpdated?: string;
}

export async function listAIAgents(limit = 50): Promise<OktaAIAgent[]> {
  const res = await aiAgentsFetch(`/workload-principals/api/v1/ai-agents?limit=${limit}&orderBy=createdDate&sortOrder=desc`);
  if (!res.ok) throw new Error(`listAIAgents ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: OktaAIAgent[] };
  return data.data || [];
}

export async function createAIAgent(name: string, description?: string): Promise<OktaAIAgent> {
  const body: any = { profile: { name } };
  if (description) body.profile.description = description;

  const res = await aiAgentsFetch('/workload-principals/api/v1/ai-agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (res.status === 202) {
    // Async operation — poll until complete
    const opUrl = res.headers.get('Location');
    if (!opUrl) throw new Error('No Location header in 202 response');
    const agentId = await pollOperation(opUrl);
    return getAIAgent(agentId);
  }

  if (!res.ok) {
    const err = await res.json() as any;
    const causes = err.errorCauses || [];
    const nameConflict = causes.some((c: any) => c.errorSummary?.includes('already exists'));
    if (nameConflict) {
      throw new Error(`An agent named "${name}" already exists in Okta. Please choose a different name.`);
    }
    throw new Error(err.errorSummary || `createAIAgent ${res.status}`);
  }

  // Synchronous 201 (in case API changes)
  return res.json() as Promise<OktaAIAgent>;
}

export async function getAIAgent(agentId: string): Promise<OktaAIAgent> {
  const res = await aiAgentsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`);
  if (!res.ok) throw new Error(`getAIAgent ${res.status}`);
  return res.json() as Promise<OktaAIAgent>;
}

export async function deleteAIAgent(agentId: string): Promise<void> {
  const res = await aiAgentsFetch(`/workload-principals/api/v1/ai-agents/${agentId}`, { method: 'DELETE' });
  if (res.status !== 204 && !res.ok) console.warn(`deleteAIAgent returned ${res.status}`);
}
