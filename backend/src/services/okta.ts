let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
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
      scope: 'okta.users.read okta.agents.manage okta.apps.manage',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Okta token error: ${err}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

async function oktaFetch(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const orgUrl = process.env.OKTA_ORG_URL!;
  const res = await fetch(`${orgUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  });
  return res;
}

export interface OktaUser {
  id: string;
  login: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  status: string;
}

export async function listUsers(query?: string, limit = 25): Promise<OktaUser[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  const res = await oktaFetch(`/api/v1/users?${params}`);
  if (!res.ok) throw new Error(`listUsers failed: ${res.status}`);
  const users = await res.json() as any[];
  return users.map((u) => ({
    id: u.id,
    login: u.profile.login,
    email: u.profile.email,
    firstName: u.profile.firstName,
    lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  }));
}

export async function getUser(userId: string): Promise<OktaUser> {
  const res = await oktaFetch(`/api/v1/users/${userId}`);
  if (!res.ok) throw new Error(`getUser failed: ${res.status}`);
  const u = await res.json() as any;
  return {
    id: u.id,
    login: u.profile.login,
    email: u.profile.email,
    firstName: u.profile.firstName,
    lastName: u.profile.lastName,
    displayName: `${u.profile.firstName} ${u.profile.lastName}`.trim() || u.profile.login,
    status: u.status,
  };
}

export async function createAgent(name: string, description: string): Promise<{ id: string; name: string; status: string }> {
  const res = await oktaFetch('/api/v1/agents', {
    method: 'POST',
    body: JSON.stringify({ name, description, type: 'CUSTOM' }),
  });

  if (res.status === 404 || res.status === 400) {
    // O4AA not enabled or endpoint not yet available — return mock for demo purposes
    console.warn('⚠️  Okta /api/v1/agents returned', res.status, '— using mock agent ID (O4AA may not be enabled on this tenant)');
    return { id: `mock-${Date.now()}`, name, status: 'ACTIVE' };
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`createAgent failed: ${res.status} — ${err}`);
  }
  const agent = await res.json() as any;
  return { id: agent.id, name: agent.name || name, status: agent.status || 'ACTIVE' };
}

export async function getAgent(agentId: string) {
  if (agentId.startsWith('mock-')) return { id: agentId, status: 'ACTIVE' };
  const res = await oktaFetch(`/api/v1/agents/${agentId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  if (agentId.startsWith('mock-')) return;
  const res = await oktaFetch(`/api/v1/agents/${agentId}`, { method: 'DELETE' });
  if (res.status !== 204 && !res.ok) {
    console.warn('deleteAgent returned', res.status);
  }
}
