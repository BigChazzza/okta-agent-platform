// Shared node/edge/token types for the Exercise/Chat/Logging graph pages — ported from a
// colleague's independent build of this app. Only the data shapes + id helpers live here; the
// live interactive logic (fetchNeighbors, step execution) is Exercise-specific and lives in
// exercise/graph/graphData.ts + usePathRunner.ts, added when Exercise itself is ported.

export interface AgentOption { id: string; name: string; oktaAgentId?: string; }

// Plain data objects (no React Flow types here) — each graph page converts these into React
// Flow Node/Edge objects once dagre has computed positions.

export interface AgentNodeData { kind: 'agent'; dashboardId: string; oktaAgentId?: string; name: string; }
export interface AppNodeData { kind: 'app'; oktaAppId: string; name: string; isMachineOrigin?: boolean; }
export interface ResourceNodeData {
  kind: 'resource'; connectionId: string; name: string;
  resourceTypeId: 'auth_server' | 'secret' | 'service_account' | 'application' | 'mcp_server';
  sub?: string; scopeCount?: number;
}
export interface OriginNodeData { kind: 'origin'; originKind: 'user'; agentDashboardId: string; label: string; supertitle?: string; }

export type GraphNodeData = AgentNodeData | AppNodeData | ResourceNodeData | OriginNodeData;
export interface GraphNode { id: string; data: GraphNodeData; }
export interface GraphEdge { id: string; source: string; target: string; label?: string; }

export function agentNodeId(dashboardId: string) { return `agent:${dashboardId}`; }
export function appNodeId(oktaAppId: string) { return `app:${oktaAppId}`; }
export function resourceNodeId(connectionId: string) { return `resource:${connectionId}`; }
export function originNodeId(agentDashboardId: string) { return `origin:user:${agentDashboardId}`; }

// Token-chip types shown on a graph node (TokenIcons.tsx) — AT = access token, ID = ID token,
// JAG = id-jag (XAA token-exchange intermediate).
export type TokenType = 'AT' | 'ID' | 'JAG';
export interface HopResult { label: string; result: import('@/components/TokenStepCard').TokenResult; tokenType: TokenType; }
