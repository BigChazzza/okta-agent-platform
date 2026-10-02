'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, X, Wifi, WifiOff, CheckCircle2, XCircle } from 'lucide-react';
import EventLog from './EventLog';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface Milestone {
  id: string; ts: string; label: string; status: 'done' | 'error';
  detail?: string; error?: string;
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Embedded live-progress panel for the agent request wizard — a page-local companion to the
// form, not a replacement for the app's global Okta API EventLog sidebar. Streams translated
// milestones from /api/agent-requests/events while the (synchronous) onboarding POST is in
// flight, and can still fall back to the raw API log via the same embedded EventLog component.
export default function ProvisioningPanel() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [connected, setConnected] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  function connect() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${BACKEND}/api/agent-requests/events`, { withCredentials: true });
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;
        setMilestones((prev) => [...prev.slice(-49), data as Milestone]);
      } catch {}
    };
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [milestones.length]);

  return (
    <div className="w-80 flex-shrink-0 flex flex-col border border-[#1e293b] rounded-xl bg-[#0d1525] self-start sticky top-8" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e293b] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[#1662dd]" />
          <span className="text-xs font-semibold text-white">Provisioning</span>
        </div>
        <div className="flex items-center gap-1.5">
          {connected
            ? <span title="Connected"><Wifi className="w-3 h-3 text-emerald-400" /></span>
            : <span title="Disconnected"><WifiOff className="w-3 h-3 text-red-400" /></span>}
          {milestones.length > 0 && (
            <button onClick={() => setMilestones([])} title="Clear" className="text-slate-600 hover:text-slate-300 p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto text-xs" style={{ minHeight: 160 }}>
        {milestones.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600 px-6 text-center py-10">
            <Sparkles className="w-6 h-6 opacity-30" />
            <p>Submit the request to watch Okta provision it live</p>
          </div>
        ) : (
          <div className="py-2 px-3 space-y-2.5">
            {milestones.map((m) => (
              <div key={m.id} className="flex items-start gap-2.5">
                {m.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{m.label}</div>
                  {(m.detail || m.error) && (
                    <div className={`text-xs mt-0.5 ${m.status === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
                      {m.error || m.detail}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-600 mt-0.5">{timeStr(m.ts)}</div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[#1e293b] flex-shrink-0">
        <button
          onClick={() => setShowRaw((s) => !s)}
          className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-slate-400 hover:text-white transition-colors"
        >
          <span>Show raw API log</span>
          {showRaw ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {showRaw && (
          <div className="flex border-t border-[#1e293b]" style={{ height: 320 }}>
            <EventLog />
          </div>
        )}
      </div>
    </div>
  );
}
