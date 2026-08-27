'use client';
import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, X, RotateCcw, Wifi, WifiOff } from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface ApiEvent {
  id: string; ts: string; method: string; path: string; label: string;
  requestBody?: any; status?: number; durationMs?: number; error?: string;
}

const METHOD_STYLE: Record<string, string> = {
  GET:    'bg-sky-500/20 text-sky-300 border-sky-500/30',
  POST:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  PUT:    'bg-amber-500/20 text-amber-300 border-amber-500/30',
  PATCH:  'bg-violet-500/20 text-violet-300 border-violet-500/30',
  DELETE: 'bg-red-500/20 text-red-300 border-red-500/30',
};

function statusColour(s?: number) {
  if (!s) return 'text-slate-500';
  if (s < 300) return 'text-emerald-400';
  if (s < 400) return 'text-amber-400';
  return 'text-red-400';
}

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Shorten long ORNs and IDs in displayed paths
function shortenPath(path: string) {
  return path
    .replace(/[a-z0-9]{20,}/gi, (m) => m.slice(0, 8) + '…')
    .replace(process.env.NEXT_PUBLIC_OKTA_ORG || '', '');
}

export default function EventLog() {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const [visible, setVisible] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  function connect() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`${BACKEND}/api/events`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => { setConnected(false); };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'connected') return;
        setEvents(prev => [...prev.slice(-99), data as ApiEvent]); // keep last 100
      } catch {}
    };
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, []);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!visible) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-xl text-xs text-slate-400 hover:text-white hover:border-[#1662dd]/40 transition-colors"
      >
        <Activity className="w-3.5 h-3.5 text-[#1662dd]" />
        API Events
        {events.length > 0 && (
          <span className="bg-[#1662dd]/20 text-[#60a5fa] px-1.5 py-0.5 rounded font-semibold">{events.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="w-80 flex-shrink-0 flex flex-col border-l border-[#1e293b] bg-[#080e1a]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e293b] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#1662dd]" />
          <span className="text-xs font-semibold text-white">Okta API Events</span>
          {events.length > 0 && (
            <span className="text-xs bg-[#1662dd]/15 text-[#60a5fa] px-1.5 py-0.5 rounded font-semibold">{events.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {connected
            ? <span title="Connected"><Wifi className="w-3 h-3 text-emerald-400" /></span>
            : <span title="Disconnected"><WifiOff className="w-3 h-3 text-red-400" /></span>
          }
          <button onClick={connect} title="Reconnect" className="text-slate-600 hover:text-slate-300 p-0.5">
            <RotateCcw className="w-3 h-3" />
          </button>
          {events.length > 0 && (
            <button onClick={() => setEvents([])} title="Clear" className="text-slate-600 hover:text-slate-300 p-0.5">
              <X className="w-3 h-3" />
            </button>
          )}
          <button onClick={() => setVisible(false)} title="Hide" className="text-slate-600 hover:text-slate-300 p-0.5">
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto text-xs">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
            <Activity className="w-6 h-6 opacity-30" />
            <p className="text-center px-4">
              {connected ? 'Perform any action to see live API calls' : 'Connecting to event stream…'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {events.map((evt) => {
              const isExpanded = expanded.has(evt.id);
              const hasBody = evt.requestBody && Object.keys(evt.requestBody).length > 0;
              return (
                <div key={evt.id} className="border-b border-[#0f1929] last:border-0">
                  <button
                    onClick={() => hasBody && toggleExpand(evt.id)}
                    className={`w-full text-left px-3 py-2 hover:bg-white/3 transition-colors ${hasBody ? 'cursor-pointer' : 'cursor-default'}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {/* Method badge */}
                      <span className={`px-1 py-0.5 rounded border text-[10px] font-bold font-mono flex-shrink-0 ${METHOD_STYLE[evt.method] || 'bg-slate-500/20 text-slate-300 border-slate-500/30'}`}>
                        {evt.method}
                      </span>
                      {/* Status */}
                      {evt.status && (
                        <span className={`font-mono font-semibold flex-shrink-0 ${statusColour(evt.status)}`}>
                          {evt.status}
                        </span>
                      )}
                      {/* Duration */}
                      {evt.durationMs && (
                        <span className="text-slate-600 flex-shrink-0">{evt.durationMs}ms</span>
                      )}
                      <span className="text-slate-600 ml-auto flex-shrink-0">{timeStr(evt.ts)}</span>
                      {hasBody && (
                        isExpanded
                          ? <ChevronDown className="w-3 h-3 text-slate-600 flex-shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
                      )}
                    </div>
                    {/* Label */}
                    <div className="text-white font-medium truncate">{evt.label}</div>
                    {/* Path */}
                    <div className="text-slate-500 font-mono truncate mt-0.5">{shortenPath(evt.path)}</div>
                  </button>

                  {/* Expanded request body */}
                  {isExpanded && hasBody && (
                    <div className="px-3 pb-2">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Request Body</div>
                      <pre className="text-[10px] text-slate-300 bg-[#0d1525] border border-[#1e293b] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                        {JSON.stringify(evt.requestBody, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[#1e293b] flex-shrink-0">
        <p className="text-[10px] text-slate-600 text-center">
          Live Okta Management API · {BACKEND.replace('https://','').replace('http://','').split('/')[0]}
        </p>
      </div>
    </div>
  );
}
