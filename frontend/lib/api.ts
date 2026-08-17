const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

export async function apiFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${err}`);
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  oktaAgentId?: string;
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  status: string;
  createdBy?: string;
  createdAt: string;
  resourceCount?: number;
  resources?: Resource[];
}

export interface Resource {
  id: string;
  name: string;
  type: string;
  description?: string;
  config?: any;
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
