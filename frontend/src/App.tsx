import { useEffect, useMemo, useRef, useState } from 'react';
import * as Sentry from '@sentry/react';
import type { AnswerResult } from './lib/contracts';
import { loadHistory, saveHistory, clearHistory, type HistoryTurn } from './lib/history';
import { postChat } from './lib/api';
import { clearSessionId, getOrCreateSessionId, syncSessionIdFromServer } from './lib/session';
import { ChatComposer, type UploadItem } from './components/ChatComposer';
import { ChatMessage, type ChatMessageModel } from './components/ChatMessage';
import { SidebarHistory } from './components/SidebarHistory';
import { TopBar } from './components/TopBar';

const CHAT_ENDPOINT = 'https://prag.ericijeoma7767.workers.dev/chat';

type StoredTurn = HistoryTurn & { attachments?: { id: string; name: string }[] };

type ChatEnvelope = {
  ok: boolean;
  result?: AnswerResult;
  traceId?: string;
  session_id?: string;
  error?: { code?: string; message?: string; details?: unknown };
};

type ChatRequestWithScope = {
  query: string;
  session_id?: string;
  document_ids?: string[];
};

function toHistoryTurn(msg: ChatMessageModel): HistoryTurn {
  if (msg.role === 'user') {
    return {
      id: msg.id,
      role: 'user',
      content: msg.content,
      createdAt: msg.createdAt,
      ...(msg.attachments ? { attachments: msg.attachments } : {}),
    } as StoredTurn;
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

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => v?.trim())
        .filter((v): v is string => Boolean(v)),
    ),
  );
}

function getHeaderTraceId(res: Response): string | undefined {
  return (
    res.headers.get('x-trace-id') ??
    res.headers.get('cf-trace-id') ??
    res.headers.get('trace-id') ??
    undefined
  )?.toString();
}

async function postChatWithScope(req: ChatRequestWithScope): Promise<AnswerResult> {
  const document_ids = uniqueStrings(req.document_ids ?? []);

  if (document_ids.length === 0) {
    return postChat({
      query: req.query,
      session_id: req.session_id,
    });
  }

  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(req.session_id ? { 'x-session-id': req.session_id } : {}),
    },
    body: JSON.stringify({
      query: req.query,
      session_id: req.session_id,
      document_ids,
    }),
  });

  const traceIdFromHeader = getHeaderTraceId(res);

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = { ok: false, error: { message: 'Invalid JSON response from server.' } };
  }

  const env = json as ChatEnvelope;
  const data = (env.result ?? {}) as Partial<AnswerResult>;
  const traceId = env.traceId ?? data.traceId ?? traceIdFromHeader;
  const session_id = env.session_id ?? data.session_id ?? req.session_id;

  Sentry.addBreadcrumb({
    category: 'fetch',
    message: 'POST /chat',
    level: 'info',
    data: {
      session_id,
      traceId,
      status: res.status,
      ok: res.ok,
      document_ids: document_ids.length,
    },
  });

  if (!res.ok || env.ok === false) {
    const err = new Error(`Chat API error: ${res.status} ${env.error?.code ?? ''} ${env.error?.message ?? ''}`);
    Sentry.captureException(err, {
      extra: { response: env, status: res.status, traceId, session_id },
    });
    throw err;
  }

  return {
    answer: String(data.answer ?? ''),
    verified: data.verified,
    degraded: data.degraded,
    citations: data.citations,
    traceId,
    session_id: data.session_id,
  };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessageModel[]>(() => {
    const hist = loadHistory();
    if (hist.length === 0) return [];

    return hist.map((t: StoredTurn) =>
      t.role === 'user'
        ? ({
            id: t.id,
            role: 'user',
            content: t.content,
            createdAt: t.createdAt,
            attachments: t.attachments,
          } as const)
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

  async function send(text: string, attachments: UploadItem[] = []) {
    setError(null);
    setBusy(true);

    const session_id = getOrCreateSessionId();
    Sentry.setTag('session_id', session_id);

    const mappedAttachments = attachments.map((u) => ({ id: u.id, name: u.file.name }));

    const userMsg: ChatMessageModel = {
      id: makeId('u'),
      role: 'user',
      content: text,
      createdAt: Date.now(),
      attachments: mappedAttachments,
    };
    setMessages((m) => [...m, userMsg]);

    try {
      const queryText = text.trim() || 'Analyze the uploaded document(s)';
      const document_ids = uniqueStrings(attachments.map((u) => u.documentId));

      const result = await postChatWithScope({
        query: queryText,
        session_id,
        document_ids,
      });

      syncSessionIdFromServer(result.session_id);

      if (result.traceId) {
        Sentry.setTag('traceId', result.traceId);
      }

      const assistantMsg: ChatMessageModel = {
        id: makeId('a'),
        role: 'assistant',
        result,
        createdAt: Date.now(),
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch (e) {
      Sentry.captureException(e);
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

              {busy ? <div className="text-sm text-slate-500">Thinking…</div> : null}
            </div>
          </div>

          <ChatComposer disabled={busy} onSend={send} />
        </main>
      </div>
    </div>
  );
}