import { EventEmitter } from 'events';

export interface OktaApiEvent {
  id: string;
  ts: string;           // ISO timestamp
  method: string;
  path: string;
  label: string;        // human-readable description
  requestBody?: any;
  status?: number;
  durationMs?: number;
  error?: string;
}

// Singleton event bus — okta.ts emits, SSE route subscribes
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);

let seq = 0;
export function nextId() { return `evt-${Date.now()}-${++seq}`; }

// Map paths → human-readable labels
const PATH_LABELS: [RegExp, string][] = [
  [/\/workload-principals\/api\/v1\/ai-agents\/[^/]+\/lifecycle\/activate/i, 'Activate AI Agent'],
  [/\/workload-principals\/api\/v1\/ai-agents\/[^/]+\/lifecycle\/deactivate/i, 'Deactivate AI Agent'],
  [/\/workload-principals\/api\/v1\/ai-agents\/[^/]+\/connections\/[^/]+/i, 'Delete Resource Connection'],
  [/\/workload-principals\/api\/v1\/ai-agents\/[^/]+\/connections/i, 'Create Resource Connection'],
  [/\/workload-principals\/api\/v1\/ai-agents\/[^/]+\/credentials\/jwks/i, 'Manage Agent JWKS Keys'],
  [/\/workload-principals\/api\/v1\/ai-agents\/[^/]+/i, 'Get / Update AI Agent'],
  [/\/workload-principals\/api\/v1\/ai-agents/i, 'List / Register AI Agents'],
  [/\/workload-principals\/api\/v1\/potential-connections/i, 'List Potential Connections'],
  [/\/workload-principals\/api\/v1\/operations\//i, 'Poll Async Operation'],
  [/\/api\/v1\/apps\/[^/]+$/i, 'Get / Update App Credentials'],
  [/\/api\/v1\/users\/[^/]+$/i, 'Get User'],
  [/\/api\/v1\/users/i, 'List Users'],
  [/\/api\/v1\/authorizationServers/i, 'List Authorization Servers'],
  [/\/governance\/api\/v1\/resource-owners/i, 'Set Resource Owner (IGA)'],
  [/\/oauth2\/v1\/token/i, 'Get Access Token'],
];

export function labelForPath(method: string, path: string): string {
  // Override by method for common patterns
  if (method === 'DELETE' && path.includes('/connections/')) return 'Delete Resource Connection';
  if (method === 'DELETE' && path.includes('/ai-agents/')) return 'Delete AI Agent';
  if (method === 'POST' && path.endsWith('/ai-agents')) return 'Register AI Agent';
  if (method === 'GET' && path.endsWith('/ai-agents')) return 'List AI Agents';
  if (method === 'GET' && path.includes('/ai-agents/') && !path.includes('/connections') && !path.includes('/lifecycle')) return 'Get AI Agent';
  if (method === 'POST' && path.includes('/connections') && !path.includes('/connections/')) return 'Create Resource Connection';
  if (method === 'GET' && path.includes('/connections')) return 'List Agent Connections';
  if (method === 'GET' && path.includes('/potential-connections')) return 'List Potential Connections';

  for (const [regex, label] of PATH_LABELS) {
    if (regex.test(path)) return label;
  }
  return `${method} ${path.replace(/\/[a-z0-9]{20,}/gi, '/…')}`;
}
