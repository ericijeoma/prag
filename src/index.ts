import * as Sentry from '@sentry/cloudflare';
import { handleRequest, type AppEnv as BaseAppEnv, type IngestJob } from './app/routes.js';
import { IngestService } from './features/ingestion/ingest-service.js';
import { createSupabaseClient } from './infrastructure/supabase/client.js';

type WorkerEnv = BaseAppEnv & {
  SENTRY_WORKER_DSN: string;
  SENTRY_RELEASE?: string;
};

type MarkdownSuccess = {
  format: 'markdown';
  data: string;
};

type MarkdownError = {
  format: 'error';
  error: string;
};

type MarkdownConversionResult = MarkdownSuccess | MarkdownError;

type MarkdownConverter = {
  toMarkdown: (input: {
    name: string;
    blob: Blob;
  }) => Promise<MarkdownConversionResult | MarkdownConversionResult[]>;
};

const RELEASE = 'rag@1.0.0';

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin.startsWith('http://localhost:')) return true;
  if (origin.startsWith('http://127.0.0.1:')) return true;
  if (origin.endsWith('.prag-frontend.pages.dev')) return true;
  return false;
}

function buildCorsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : null;

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Vary', 'Origin');
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, x-session-id, x-trace-id, sentry-trace, baggage',
  );

  return headers;
}

function withCors(res: Response, origin: string | null): Response {
  const corsHeaders = buildCorsHeaders(origin);
  const newHeaders = new Headers(res.headers);

  for (const [key, value] of corsHeaders.entries()) {
    newHeaders.set(key, value);
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeText(text: string): string {
  if (!text) return '';

  let result = '';

  for (const char of text.normalize('NFKC')) {
    const code = char.charCodeAt(0);

    const isControlCharacter =
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127;

    if (!isControlCharacter) {
      result += char;
    }
  }

  return result.trim();
}

function getMarkdownConverter(env: WorkerEnv): MarkdownConverter {
  return env.AI as unknown as MarkdownConverter;
}

function isMarkdownSuccess(value: unknown): value is MarkdownSuccess {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.format === 'markdown' && typeof record.data === 'string';
}

function isMarkdownError(value: unknown): value is MarkdownError {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.format === 'error' && typeof record.error === 'string';
}

function extractMarkdownText(result: MarkdownConversionResult | MarkdownConversionResult[]): string {
  const items = Array.isArray(result) ? result : [result];

  const markdown = items
    .filter(isMarkdownSuccess)
    .map((item) => item.data)
    .filter((part) => part.trim().length > 0)
    .join('\n\n');

  if (markdown.trim().length > 0) {
    return markdown;
  }

  const errors = items.filter(isMarkdownError).map((item) => item.error).filter((part) => part.trim().length > 0);
  if (errors.length > 0) {
    throw new Error(errors[0]);
  }

  throw new Error('Markdown conversion produced no readable text');
}

async function extractTextWithCloudflareMarkdown(
  env: WorkerEnv,
  fileName: string,
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const converter = getMarkdownConverter(env);
  const result = await converter.toMarkdown({
    name: fileName,
    blob: new Blob([buffer], { type: mimeType }),
  });

  return sanitizeText(normalizeText(extractMarkdownText(result)));
}

async function extractContentText(
  env: WorkerEnv,
  ext: string,
  fileName: string,
  buffer: ArrayBuffer,
): Promise<string> {
  const fileExt = ext.toLowerCase().trim();

  switch (fileExt) {
    case 'txt':
    case 'md':
      return sanitizeText(normalizeText(new TextDecoder('utf-8').decode(buffer)));

    case 'pdf':
      return extractTextWithCloudflareMarkdown(env, fileName, buffer, 'application/pdf');

    case 'docx':
      return extractTextWithCloudflareMarkdown(
        env,
        fileName,
        buffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );

    default:
      throw new Error(`Unsupported file extension: ${ext}`);
  }
}

async function extractContentBuffer(env: WorkerEnv, kvKey: string): Promise<ArrayBuffer | null> {
  return env.TEMP_FILES.get(kvKey, { type: 'arrayBuffer' });
}

async function processQueue(batch: MessageBatch<unknown>, env: WorkerEnv): Promise<void> {
  for (const msg of batch.messages) {
    const job = msg.body as IngestJob;
    const { kvKey, fileName, ext, title, metadata, traceId, sessionId } = job;

    try {
      const buffer = await extractContentBuffer(env, kvKey);
      if (!buffer) {
        msg.ack();
        continue;
      }

      const content = await extractContentText(env, ext, fileName, buffer);
      const supabase = createSupabaseClient(env);
      const svc = new IngestService({ supabase, env });

      await svc.ingest({
        title,
        content,
        metadata: {
          ...metadata,
          session_id: sessionId,
        },
        file_path: fileName,
        source_type: ext,
        trace_id: traceId,
      });

      await env.TEMP_FILES.delete(kvKey);
      msg.ack();
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[ingest] Failed to process ${fileName}:`, err);
      msg.retry();
    }
  }
}

export default Sentry.withSentry(
  (env: WorkerEnv) => ({
    dsn: env.SENTRY_WORKER_DSN,
    release: env.SENTRY_RELEASE ?? RELEASE,
    tracesSampleRate: 0.2,
  }),
  {
    async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
      const origin = request.headers.get('Origin');

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
      }

      try {
        const response = await handleRequest(request, env);
        return withCors(response, origin);
      } catch (error) {
        Sentry.captureException(error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return withCors(Response.json({ ok: false, error: { message } }, { status: 500 }), origin);
      }
    },

    async queue(batch: MessageBatch<unknown>, env: WorkerEnv): Promise<void> {
      await processQueue(batch, env);
    },
  } satisfies ExportedHandler<WorkerEnv>,
);