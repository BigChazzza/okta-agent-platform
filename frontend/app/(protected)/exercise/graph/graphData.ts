import type {
  AgentOption, AgentNodeData, AppNodeData, ResourceNodeData, OriginNodeData,
  GraphNodeData, GraphNode, GraphEdge,
} from '@/components/graph/graphTypes';
import { agentNodeId, appNodeId, resourceNodeId, originNodeId } from '@/components/graph/graphTypes';

export type { AgentOption, AgentNodeData, AppNodeData, ResourceNodeData, OriginNodeData, GraphNodeData, GraphNode, GraphEdge };
export { agentNodeId, appNodeId, resourceNodeId, originNodeId };

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Connection types that terminate the chain (everything except agent-to-agent, which instead
// produces an 'agent' node via delegations-from).
function resourceTypeIdFor(connectionType: string): ResourceNodeData['resourceTypeId'] | null {
  switch (connectionType) {
    case 'IDENTITY_ASSERTION_CUSTOM_AS': return 'auth_server';
    case 'STS_VAULT_SECRET': return 'secret';
    case 'STS_SERVICE_ACCOUNT': return 'service_account';
    case 'STS_ACCESS_TOKEN':
    case 'IDENTITY_ASSERTION_APP_INSTANCE': return 'application';
    case 'IDENTITY_ASSERTION_VIRTUAL_MCP_SERVER': return 'mcp_server';
    default: return null;
  }
}

function connectionName(c: any): string {
  if (c.authorizationServer?.name) return c.authorizationServer.name;
  if (c.resource?.appInstanceName) return c.resource.appInstanceName;
  if (c.resource?.name) return c.resource.name;
  if (c.resource?.clientAuthSettings?.name) return c.resource.clientAuthSettings.name;
  return c.connectionType;
}

interface Neighbors { nodes: GraphNode[]; edges: GraphEdge[]; }

// Fetches everything one hop away from `dashboardAgentId` in both directions: who can call it
// (delegations — agents and apps), what it can call (delegations-from — other agents), and what
// non-agent resources it's connected to (connections, filtered to terminal types).
export async function fetchNeighbors(dashboardAgentId: string, agents: AgentOption[]): Promise<Neighbors> {
  const self = agents.find((a) => a.id === dashboardAgentId);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const [agentDetail, callers, downstream, connections, config] = await Promise.all([
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}`).then((r) => r.json()).catch(() => null),
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}/delegations`).then((r) => r.json()).catch(() => []),
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}/delegations-from`).then((r) => r.json()).catch(() => []),
    fetch(`${BACKEND}/api/agents/${dashboardAgentId}/connections`).then((r) => r.json()).catch(() => []),
    fetch(`${BACKEND}/api/exercise/config`).then((r) => r.json()).catch(() => null),
  ]);
  const serviceClientId: string | null = config?.serviceClientId ?? null;

  const selfNodeId = agentNodeId(dashboardAgentId);

  // Callers feeding in from the left (Machine Access — agents and apps already authorized).
  if (Array.isArray(callers)) {
    for (const c of callers) {
      if (!c.callerAgentId) continue;
      if (c.callerType === 'app') {
        const id = appNodeId(c.callerAgentId);
        const isMachineOrigin = !!serviceClientId && c.callerAgentId === serviceClientId;
        nodes.push({ id, data: { kind: 'app', oktaAppId: c.callerAgentId, name: c.callerName || 'App', isMachineOrigin } });
        edges.push({ id: `e:${id}->${selfNodeId}`, source: id, target: selfNodeId, label: 'Machine' });
      } else {
        const callerAgent = agents.find((a) => a.oktaAgentId === c.callerAgentId);
        const id = agentNodeId(callerAgent?.id || c.callerAgentId);
        nodes.push({
          id,
          data: { kind: 'agent', dashboardId: callerAgent?.id || c.callerAgentId, oktaAgentId: c.callerAgentId, name: c.callerName || callerAgent?.name || 'Agent' },
        });
        edges.push({ id: `e:${id}->${selfNodeId}`, source: id, target: selfNodeId, label: 'Machine' });
      }
    }
  }

  // Real user login is a distinct entry point — synthesize a single origin node for it when enabled.
  if (agentDetail?.userAccessEnabled) {
    const id = originNodeId(dashboardAgentId);
    nodes.push({ id, data: { kind: 'origin', originKind: 'user', agentDashboardId: dashboardAgentId, label: 'User login' } });
    edges.push({ id: `e:${id}->${selfNodeId}`, source: id, target: selfNodeId, label: 'User' });
  }

  // Downstream agents fanning out to the right.
  if (Array.isArray(downstream)) {
    for (const d of downstream) {
      const targetAgent = agents.find((a) => a.oktaAgentId === d.targetAgentId);
      const id = agentNodeId(targetAgent?.id || d.targetAgentId);
      nodes.push({
        id,
        data: { kind: 'agent', dashboardId: targetAgent?.id || d.targetAgentId, oktaAgentId: d.targetAgentId, name: d.targetName || targetAgent?.name || 'Agent' },
      });
      edges.push({ id: `e:${selfNodeId}->${id}`, source: selfNodeId, target: id, label: 'Machine' });
    }
  }

  // Terminal resources (Custom AS, MCP server, vault secret, service account, app instance) —
  // agent-to-agent connections are skipped here since delegations-from already covers those.
  if (Array.isArray(connections)) {
    for (const c of connections) {
      const resourceTypeId = resourceTypeIdFor(c.connectionType);
      if (!resourceTypeId) continue;
      const id = resourceNodeId(c.id);
      nodes.push({
        id,
        data: {
          kind: 'resource', connectionId: c.id, name: connectionName(c), resourceTypeId,
          sub: c.authorizationServer?.name && resourceTypeId !== 'auth_server' ? `via ${c.authorizationServer.name}` : undefined,
          scopeCount: Array.isArray(c.scopes) && !c.scopes.includes('*') ? c.scopes.length : undefined,
        },
      });
      const label = c.scopes && Array.isArray(c.scopes) && !c.scopes.includes('*') ? `${c.scopes.length} scopes` : undefined;
      edges.push({ id: `e:${selfNodeId}->${id}`, source: selfNodeId, target: id, label });
    }
  }

  // Ensure the center node itself is present even if it has no neighbors yet.
  if (!nodes.some((n) => n.id === selfNodeId)) {
    nodes.push({ id: selfNodeId, data: { kind: 'agent', dashboardId: dashboardAgentId, oktaAgentId: self?.oktaAgentId, name: self?.name || 'Agent' } });
  }

  return { nodes, edges };
}
