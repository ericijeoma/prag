import * as Sentry from '@sentry/react';
import type { AnswerResult, ChatRequest } from './contracts';

const CHAT_ENDPOINT = 'https://prag.ericijeoma7767.workers.dev/chat';

export type ChatResponse = AnswerResult;

type ChatEnvelope = {
  ok: boolean;
  result?: AnswerResult;
  traceId?: string;
  error?: { code?: string; message?: string };
};

function getHeaderTraceId(res: Response): string | undefined {
  // Allow for different header conventions
  return (
    res.headers.get('x-trace-id') ??
    res.headers.get('cf-trace-id') ??
    res.headers.get('trace-id') ??
    undefined
  )?.toString();
}

export async function postChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Align with backend header conventions as well
      ...(req.session_id ? { 'x-session-id': req.session_id } : {}),
    },
    body: JSON.stringify(req),
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
  const session_id = data.session_id ?? req.session_id;

  // Telemetry breadcrumb: tie client behavior to backend trace id and session id
  Sentry.addBreadcrumb({
    category: 'fetch',
    message: 'POST /chat',
    level: 'info',
    data: {
      session_id,
      traceId,
      status: res.status,
      ok: res.ok,
    },
  });

  if (!res.ok || env.ok === false) {
    const err = new Error(`Chat API error: ${res.status} ${env.error?.code ?? ''} ${env.error?.message ?? ''}`);
    // attach response for Sentry
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
