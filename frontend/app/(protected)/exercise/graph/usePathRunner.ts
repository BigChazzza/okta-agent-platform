import { useState, useCallback } from 'react';
import type { TokenResult } from '@/components/TokenStepCard';
import type { OriginNodeData, TokenType, HopResult } from '@/components/graph/graphTypes';

export type { TokenType, HopResult };

export interface PendingExchange {
  exchangeRid: string; callerNodeId: string; targetNodeId: string; targetLabel: string; kind: 'agent' | 'authserver';
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Some failures never reach Okta at all (no credential stored, network error) — the backend
// returns a bare {error} with no step2/step3 to attach an icon to. Synthesizing a TokenResult
// here means every failure still shows a red icon on the node.
function errorResult(message: string): TokenResult {
  return { ok: false, status: 0, raw: { error: message } };
}

// Drives the Exercise graph's live step-by-step execution — click a node, fire the real request
// against Okta, and track where the path currently sits so the graph can highlight the next hop.
export function usePathRunner() {
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [actingAgentId, setActingAgentId] = useState<string | null>(null);
  const [rid, setRid] = useState<string | null>(null);
  const [awaitingLogin, setAwaitingLogin] = useState(false);
  const [complete, setComplete] = useState(false);
  const [pendingExchange, setPendingExchange] = useState<PendingExchange | null>(null);

  const [steps, setSteps] = useState<HopResult[]>([]);
  // Parallel to `steps` — pathNodeIds[i] is the graph node steps[i]'s token belongs to.
  const [pathNodeIds, setPathNodeIds] = useState<string[]>([]);
  // Keyed by the node the token actually LANDED on — only ever one entry per node, only set on success.
  const [incomingByNodeId, setIncomingByNodeId] = useState<Record<string, HopResult>>({});
  // Ordered list of graph node ids the path's "current position" has actually occupied.
  const [visitedNodeIds, setVisitedNodeIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setCurrentNodeId(null); setActingAgentId(null); setRid(null);
    setAwaitingLogin(false); setComplete(false); setPendingExchange(null);
    setSteps([]); setPathNodeIds([]); setVisitedNodeIds([]); setError('');
    setIncomingByNodeId({});
  }, []);

  // Triggered by clicking the service-client app node (AppNode.tsx, isMachineOrigin) — that node
  // IS the caller identity for this grant, so its request/response icons belong on the APP node,
  // not on the agent the grant is scoped to.
  async function startMachine(agentDashboardId: string, appNodeId: string, agentNodeId: string) {
    reset(); setRunning(true);
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/${agentDashboardId}/machine-access/token`, { method: 'POST' });
      const data = await res.json();
      const step1 = data.step1 || (!res.ok ? errorResult(data.error || 'Failed to get initial token') : undefined);
      if (step1) { setSteps([{ label: 'Service Client Grant', result: step1, tokenType: 'AT' }]); setPathNodeIds([appNodeId]); }
      if (!res.ok || !data.rid) {
        setError(data.error || data.step1?.raw?.error_description || data.step1?.raw?.error || 'Failed to get initial token');
        setRunning(false);
        return;
      }
      setIncomingByNodeId({ [agentNodeId]: { label: 'Service Client Grant', result: step1, tokenType: 'AT' } });
      setCurrentNodeId(agentNodeId);
      setVisitedNodeIds([appNodeId, agentNodeId]);
      setActingAgentId(agentDashboardId);
      setRid(data.rid);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  async function startUser(origin: OriginNodeData) {
    reset(); setRunning(true);
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/${origin.agentDashboardId}/user-access/start`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to start login'); setRunning(false); return; }
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
      setAwaitingLogin(true);
    } catch (e: any) { setError(e.message); }
    setRunning(false);
  }

  // Called once the Okta redirect callback delivers a rid — resumes the path exactly as if the
  // origin's token had arrived synchronously.
  function resumeFromLogin(loginRid: string, agentDashboardId: string, originNodeId: string, agentNodeId: string, decoded: { idToken?: any; accessToken?: any }) {
    setAwaitingLogin(false); setComplete(false); setPendingExchange(null);
    const loginResult: TokenResult = { ok: true, status: 200, decoded: decoded.idToken ? { header: {}, payload: decoded.idToken } : undefined, raw: decoded };
    setSteps([{ label: 'User Login', result: loginResult, tokenType: 'ID' }]);
    setPathNodeIds([originNodeId]);
    setIncomingByNodeId({ [agentNodeId]: { label: 'User Login', result: loginResult, tokenType: 'ID' } });
    setCurrentNodeId(agentNodeId);
    setVisitedNodeIds([originNodeId, agentNodeId]);
    setActingAgentId(agentDashboardId);
    setRid(loginRid);
  }

  // Runs the token-exchange half of a hop, triggered by clicking the CALLER node itself when it
  // has exactly one downstream option, or the direct-neighbor disambiguation path. Doesn't move
  // the path — the hop's token lands on the caller's own node, and pendingExchange records what's
  // needed to redeem it once the target node is clicked.
  async function runExchange(
    kind: 'agent' | 'authserver', targetId: string, targetNodeId: string, targetLabel: string,
    overrides?: { rid: string; callerNodeId: string }, scope?: string
  ): Promise<PendingExchange | null> {
    const effectiveRid = overrides?.rid ?? rid;
    const effectiveCallerNodeId = overrides?.callerNodeId ?? currentNodeId;
    if (!effectiveRid || !effectiveCallerNodeId) return null;
    setRunning(true); setError('');
    try {
      const body = kind === 'agent' ? { rid: effectiveRid, targetAgentId: targetId } : { rid: effectiveRid, connectionId: targetId, scope };
      const res = await fetch(`${BACKEND}/api/exercise/agents/exercise/exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      const step2 = data.step2 || (!res.ok ? errorResult(data.error || 'Failed to run exchange') : undefined);
      if (step2) {
        setSteps((prev) => [...prev, { label: `Exchange → ${targetLabel}`, result: step2, tokenType: 'JAG' }]);
        setPathNodeIds((prev) => [...prev, effectiveCallerNodeId]);
      }
      if (!res.ok || !data.exchangeRid) {
        setError(data.error || data.step2?.raw?.error_description || data.step2?.raw?.error || 'Failed to run exchange');
        setRunning(false);
        return null;
      }
      const pending: PendingExchange = { exchangeRid: data.exchangeRid, callerNodeId: effectiveCallerNodeId, targetNodeId, targetLabel, kind };
      setPendingExchange(pending);
      setRunning(false);
      return pending;
    } catch (e: any) { setError(e.message); }
    setRunning(false);
    return null;
  }

  // Runs the redemption half of a hop, triggered by clicking the TARGET node once its caller's
  // exchange has already produced a pendingExchange. Moves the path onto the target on success
  // (agent hop) or marks the chain complete (authserver hop — terminal, no further nextRid).
  async function runRedeem(pendingOverride?: PendingExchange): Promise<{ landedNodeId: string; isAgentHop: boolean; nextRid?: string } | null> {
    const effectivePending = pendingOverride ?? pendingExchange;
    if (!effectivePending) return null;
    setRunning(true); setError('');
    try {
      const res = await fetch(`${BACKEND}/api/exercise/agents/exercise/redeem`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRid: effectivePending.exchangeRid }),
      });
      const data = await res.json();
      const step3 = data.step3 || (!res.ok ? errorResult(data.error || 'Failed to redeem') : undefined);
      if (step3) {
        setSteps((prev) => [...prev, { label: `Redeem — ${effectivePending.targetLabel}`, result: step3, tokenType: 'AT' }]);
        setPathNodeIds((prev) => [...prev, effectivePending.callerNodeId]);
      }
      if (!res.ok) {
        setError(data.error || data.step3?.raw?.error_description || data.step3?.raw?.error || 'Failed to redeem');
        setRunning(false);
        return null;
      }
      const targetNodeId = effectivePending.targetNodeId;
      const wasAgentHop = effectivePending.kind === 'agent';
      setPendingExchange(null);
      setIncomingByNodeId((prev) => ({ ...prev, [targetNodeId]: { label: `Redeem — ${effectivePending.targetLabel}`, result: step3, tokenType: 'AT' } }));
      if (wasAgentHop && data.nextRid) {
        const targetDashboardId = targetNodeId.replace(/^agent:/, '');
        setCurrentNodeId(targetNodeId);
        setVisitedNodeIds((prev) => [...prev, targetNodeId]);
        setActingAgentId(targetDashboardId);
        setRid(data.nextRid);
        setRunning(false);
        return { landedNodeId: targetNodeId, isAgentHop: true, nextRid: data.nextRid };
      } else {
        setCurrentNodeId(targetNodeId);
        setVisitedNodeIds((prev) => [...prev, targetNodeId]);
        setComplete(true);
        setRunning(false);
        return { landedNodeId: targetNodeId, isAgentHop: false };
      }
    } catch (e: any) { setError(e.message); }
    setRunning(false);
    return null;
  }

  return {
    currentNodeId, actingAgentId, awaitingLogin, complete, pendingExchange,
    steps, pathNodeIds, visitedNodeIds, incomingByNodeId, running, error,
    startMachine, startUser, resumeFromLogin,
    runExchange, runRedeem, reset,
  };
}

export type PathRunner = ReturnType<typeof usePathRunner>;
