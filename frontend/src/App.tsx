import { useEffect, useMemo, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import type { AnswerResult } from './lib/contracts';
import { loadHistory, saveHistory, clearHistory, type HistoryTurn } from './lib/history';
import { postChat } from './lib/api';
import { clearSessionId, getOrCreateSessionId, syncSessionIdFromServer } from './lib/session';
import { ChatComposer } from './components/ChatComposer';
import { ChatMessage, type ChatMessageModel } from './components/ChatMessage';
import { SidebarHistory } from './components/SidebarHistory';
import { TopBar } from './components/TopBar';

function toHistoryTurn(msg: ChatMessageModel): HistoryTurn {
  if (msg.role === 'user') {
    return { id: msg.id, role: 'user', content: msg.content, createdAt: msg.createdAt };
  }
  return {
    id: msg.id,
    role: 'assistant',
    content: msg.result.answer ?? '',
    createdAt: msg.createdAt,
  };
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessageModel[]>(() => {
    // hydrate from local history (non-authoritative — backend is session source of truth)
    const hist = loadHistory();
    if (hist.length === 0) return [];
    return hist.map((t) =>
      t.role === 'user'
        ? ({ id: t.id, role: 'user', content: t.content, createdAt: t.createdAt } as const)
        : ({
            id: t.id,
            role: 'assistant',
            createdAt: t.createdAt,
            result: { answer: t.content, citations: [], verified: false, degraded: false } satisfies AnswerResult,
          } as const),
    );
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const historyTurns = useMemo(() => messages.map(toHistoryTurn), [messages]);

  useEffect(() => {
    saveHistory(historyTurns);
  }, [historyTurns]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  async function send(text: string) {
    setError(null);
    setBusy(true);

    const session_id = getOrCreateSessionId();
    Sentry.setTag('session_id', session_id);

    const userMsg: ChatMessageModel = { id: makeId('u'), role: 'user', content: text, createdAt: Date.now() };
    setMessages((m) => [...m, userMsg]);

    try {
      const result = await postChat({ query: text, session_id });

      // Sync local storage if server minted/returned a new session id.
      syncSessionIdFromServer(result.session_id);

      if (result.traceId) {
        Sentry.setTag('traceId', result.traceId);
      }

      const assistantMsg: ChatMessageModel = { id: makeId('a'), role: 'assistant', result, createdAt: Date.now() };
      setMessages((m) => [...m, assistantMsg]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function clearAllHistory() {
    clearHistory();
    setMessages([]);
  }

  function newSession() {
    clearSessionId();
    clearAllHistory();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex h-screen">
        <SidebarHistory turns={historyTurns} onClear={clearAllHistory} />

        <main className="flex min-w-0 flex-1 flex-col">
          <TopBar onNewSession={newSession} />

          <div ref={scrollerRef} className="flex-1 overflow-auto px-4 py-6">
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.length === 0 ? (
                <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-6">
                  <div className="text-lg font-semibold">Ask a question</div>
                  <div className="mt-2 text-sm text-slate-400">
                    Your <span className="font-mono">session_id</span> is persisted in localStorage and passed to the backend
                    so the Worker can load prior turns.
                  </div>
                </div>
              ) : null}

              {messages.map((m) => (
                <ChatMessage key={m.id} msg={m} />
              ))}

              {error ? (
                <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-4 text-sm text-rose-200">
                  <div className="font-semibold">Request failed</div>
                  <div className="mt-1 font-mono text-[12px] text-rose-200/90">{error}</div>
                </div>
              ) : null}

              {busy ? (
                <div className="text-sm text-slate-500">Thinking…</div>
              ) : null}
            </div>
          </div>

          <ChatComposer disabled={busy} onSend={send} />
        </main>
      </div>
    </div>
  );
}
