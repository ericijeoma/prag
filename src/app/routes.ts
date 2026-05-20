import * as Sentry from '@sentry/cloudflare'
import { createSupabaseClient, type SupabaseEnv } from '../infrastructure/supabase/client.js'
import { IngestService } from '../features/ingestion/ingest-service.js'
import { SearchService } from '../features/retrieval/search-service.js'
import { AnswerService } from '../features/agent/answer-service.js'
import type { AiBinding } from '../shared/types/ai.js'
import { ChunkRepository } from '../infrastructure/supabase/chunk-repository.js'
import { ChatService } from '../features/chat/chat-service.js'
import { buildHealthReport } from './health.js'
import { AppError, isAppError } from '../shared/http/errors.js'
import { resolveSessionId, resolveTraceId } from '../shared/trace/trace-id.js'

type Json = Record<string, unknown>

export type IngestJob = {
  kvKey: string
  fileName: string
  ext: string
  title: string
  metadata: Record<string, unknown>
  traceId: string
  sessionId: string | null
}

export type AppEnv = SupabaseEnv & {
  AI: AiBinding
  GROQ_API_KEY: string
  TEMP_FILES: KVNamespace
  ingest_queue: Queue<IngestJob>
}

type ChatRequestBody = {
  query?: string
  session_id?: string
}

const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md'] as const
type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

function isSupportedExtension(ext: string): ext is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
}

function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

function badRequest(message: string, details?: unknown): Response {
  return json({ ok: false, error: { code: 'bad_request', message, details } }, { status: 400 })
}

function methodNotAllowed(): Response {
  return json({ ok: false, error: { code: 'bad_request', message: 'Method not allowed' } }, { status: 405 })
}

// FIXED: Utilized 'err' context inside the AppError constructor details to resolve compiler warning
async function readJson<T extends Json>(req: Request): Promise<T> {
  try {
    const text = await req.text()
    if (!text.trim()) return {} as T
    return JSON.parse(text) as T
  } catch (err) {
    throw new AppError('Malformed JSON payload received', { 
      code: 'bad_request', 
      status: 400,
      details: err instanceof Error ? err.message : String(err)
    })
  }
}

function toErrorResponse(err: unknown): Response {
  if (isAppError(err)) {
    return json(
      { ok: false, error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    )
  }
  const message = err instanceof Error ? err.message : 'Unknown error'
  return json({ ok: false, error: { code: 'internal_error', message } }, { status: 500 })
}

function parseMetadata(raw: string | File | null): Record<string, unknown> {
  if (!raw || typeof raw !== 'string') return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new AppError('Invalid JSON format in metadata field', { code: 'bad_request', status: 400 })
  }
}

export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

  const traceId = resolveTraceId(request.headers)
  const sessionIdFromHeader = resolveSessionId(request.headers)

  let supabase: ReturnType<typeof createSupabaseClient> | undefined
  try {
    supabase = createSupabaseClient(env)
  } catch (err) {
    Sentry.captureException(err)
    if (!(method === 'GET' && path === '/health')) return toErrorResponse(err)
  }

  // ── GET /health ─────────────────────────────────────────────────────────────
  if (method === 'GET' && path === '/health') {
    try {
      const report = await buildHealthReport({ env, supabase })
      return json(report, { status: report.ok ? 200 : 503 })
    } catch (err) {
      Sentry.captureException(err)
      return toErrorResponse(
        err instanceof AppError
          ? err
          : new AppError('Healthcheck failed', { code: 'initialization_error', status: 503 }),
      )
    }
  }

  // ── POST /ingest ─────────────────────────────────────────────────────────────
  if (path === '/ingest') {
    if (method !== 'POST') return methodNotAllowed()

    try {
      const contentType = request.headers.get('content-type') ?? ''

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()

        const fileEntry = formData.get('file')
        if (!fileEntry || typeof fileEntry === 'string') {
          return badRequest('file field is required for multipart upload')
        }
        const file = fileEntry as unknown as File

        const MAX_BYTES = 25 * 1024 * 1024
        if (file.size > MAX_BYTES) {
          return json(
            {
              ok: false,
              error: {
                code: 'file_too_large',
                message: `File exceeds 25 MB limit (${(file.size / 1e6).toFixed(1)} MB)`,
              },
            },
            { status: 413 },
          )
        }

        const ext = getExtension(file.name)
        if (!isSupportedExtension(ext)) {
          return badRequest(
            `Unsupported file type: .${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
          )
        }

        const title = (formData.get('title') as string | null) ?? file.name
        const metadata = parseMetadata(formData.get('metadata'))
        const explicitSessionId = (formData.get('session_id') as string | null) || sessionIdFromHeader

        const kvKey = `ingest_${crypto.randomUUID()}`
        const buffer = await file.arrayBuffer()
        await env.TEMP_FILES.put(kvKey, buffer, { expirationTtl: 3600 })

        const job: IngestJob = { 
          kvKey, 
          fileName: file.name, 
          ext, 
          title, 
          metadata, 
          traceId, 
          sessionId: explicitSessionId || null 
        }
        await env.ingest_queue.send(job)

        return json(
          { ok: true, queued: true, message: 'File received and queued for processing' },
          { status: 202 },
        )
      }

      const body = await readJson<{
        title?: string
        content?: string
        metadata?: Record<string, unknown>
        file_path?: string | null
        source_type?: string
      }>(request)

      if (!body.title || !body.content) {
        return badRequest('title and content are required')
      }

      const svc = new IngestService({ supabase: supabase!, env })
      const result = await svc.ingest({
        title: body.title,
        content: body.content,
        metadata: body.metadata ?? {},
        file_path: body.file_path ?? null,
        source_type: body.source_type ?? 'upload',
        trace_id: traceId,
      })

      return json({ ok: true, result })
    } catch (err) {
      Sentry.captureException(err)
      return toErrorResponse(err)
    }
  }

  // ── POST /search ─────────────────────────────────────────────────────────────
  if (path === '/search') {
    if (method !== 'POST') return methodNotAllowed()
    try {
      const body = await readJson<{ query?: string }>(request)
      if (!body.query) return badRequest('query is required')

      const svc = new SearchService({ supabase: supabase!, env })
      const result = await svc.search({ query: body.query, topK: 5, traceId })
      return json({ ok: true, result })
    } catch (err) {
      Sentry.captureException(err)
      return toErrorResponse(err)
    }
  }

  // ── POST /answer ─────────────────────────────────────────────────────────────
  if (path === '/answer') {
    if (method !== 'POST') return methodNotAllowed()
    try {
      const body = await readJson<{ query?: string }>(request)
      if (!body.query) return badRequest('query is required')

      const searchSvc = new SearchService({ supabase: supabase!, env })
      const svc = new AnswerService({
        retrieval: searchSvc,
        repo: new ChunkRepository(supabase!),
        env: { GROQ_API_KEY: env.GROQ_API_KEY, AI: env.AI },
      })
      const result = await svc.answer({ query: body.query, traceId })
      return json({ ok: true, result })
    } catch (err) {
      Sentry.captureException(err)
      return toErrorResponse(err)
    }
  }

  // ── POST /chat ───────────────────────────────────────────────────────────────
  if (path === '/chat') {
    if (method !== 'POST') return methodNotAllowed()
    try {
      const body = await readJson<ChatRequestBody>(request)
      const query = body.query?.trim()
      if (!query) return badRequest('query is required')

      const sessionId = body.session_id?.trim() || sessionIdFromHeader

      const searchSvc = new SearchService({ supabase: supabase!, env })
      const answerSvc = new AnswerService({
        retrieval: searchSvc,
        repo: new ChunkRepository(supabase!),
        env: { GROQ_API_KEY: env.GROQ_API_KEY, AI: env.AI },
      })
      const chatSvc = new ChatService({
        answer: answerSvc,
        memory: new ChunkRepository(supabase!),
      })

      const chat = await chatSvc.chat({ query, traceId, sessionId })

      return json({
        ok: true,
        result: { ...chat.result, session_id: chat.session_id },
        traceId: chat.traceId,
      })
    } catch (err) {
      Sentry.captureException(err)
      return toErrorResponse(err)
    }
  }

  return json({ ok: false, error: { code: 'not_found', message: 'Not found' } }, { status: 404 })
}