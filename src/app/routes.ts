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

async function readJson<T extends Json>(req: Request): Promise<T> {
  const text = await req.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

function toErrorResponse(err: unknown): Response {
  if (isAppError(err)) {
    return json(
      {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      { status: err.status },
    )
  }

  const message = err instanceof Error ? err.message : 'Unknown error'
  return json(
    {
      ok: false,
      error: {
        code: 'internal_error',
        message,
      },
    },
    { status: 500 },
  )
}

export type AppEnv = SupabaseEnv & {
  AI: AiBinding
  GROQ_API_KEY: string
}

type ChatRequestBody = {
  query?: string
  session_id?: string
}

export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

  // Global TraceID + session headers
  const traceId = resolveTraceId(request.headers)
  const sessionIdFromHeader = resolveSessionId(request.headers)

  let supabase: ReturnType<typeof createSupabaseClient> | undefined
  try {
    supabase = createSupabaseClient(env)
  } catch (err) {
    // Allow /health to report missing env gracefully.
    if (!(method === 'GET' && path === '/health')) return toErrorResponse(err)
  }

  if (method === 'GET' && path === '/health') {
    try {
      const report = await buildHealthReport({ env, supabase })
      return json(report, { status: report.ok ? 200 : 503 })
    } catch (err) {
      // If DB healthcheck throws, return structured error.
      return toErrorResponse(
        err instanceof AppError
          ? err
          : new AppError('Healthcheck failed', { code: 'initialization_error', status: 503 }),
      )
    }
  }

  if (path === '/ingest') {
    if (method !== 'POST') return methodNotAllowed()
    try {
      const contentType = request.headers.get('content-type') ?? ''

      let title: string
      let content: string
      let metadata: Record<string, unknown> = {}
      let file_path: string | null = null
      let source_type = 'upload'

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()
        // Cloudflare Workers' FormData typings sometimes omit File in FormDataEntryValue.
        // Cast to the runtime shape we expect so we can safely access `name` after narrowing.
        const file = formData.get('file') as unknown as File | string | null

        if (!file || typeof file === 'string') {
          return badRequest('file field is required for multipart upload')
        }

        source_type = file.name.endsWith('.pdf')? 'pdf': 'text'
        if (source_type == 'pdf'){

          // Extract text from PDF using unpdf
          const { extractText } = await import('unpdf')
          const buffer = await file.arrayBuffer()
          const { text } = await extractText(new Uint8Array(buffer), {
            mergePages: true,
          })
          content = text
        }
        else{
          content = await file.text()
        }

        title = (formData.get('title') as string | null) ?? file.name
        file_path = file.name

        const metaRaw = formData.get('metadata')
        if (metaRaw && typeof metaRaw === 'string') {
          try {
            metadata = JSON.parse(metaRaw)
          } catch {
            /* ignore */
          }
        }
      } else {
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

        title = body.title
        content = body.content
        metadata = body.metadata ?? {}
        file_path = body.file_path ?? null
        source_type = body.source_type ?? 'upload'
      }

      const svc = new IngestService({ supabase: supabase!, env })
      const result = await svc.ingest({
        title,
        content,
        metadata,
        file_path,
        source_type,
        trace_id: traceId,
      })

      return json({ ok: true, result })
    } catch (err) {
      return toErrorResponse(err)
    }
  }

  if (path === '/search') {
    if (method !== 'POST') return methodNotAllowed()
    try {
      const body = await readJson<{ query?: string }>(request)
      if (!body.query) return badRequest('query is required')

      const svc = new SearchService({ supabase: supabase!, env })
      const result = await svc.search({ query: body.query, topK: 5, traceId })
      return json({ ok: true, result })
    } catch (err) {
      return toErrorResponse(err)
    }
  }

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
      return toErrorResponse(err)
    }
  }

  if (path === '/chat') {
    if (method !== 'POST') return methodNotAllowed()
    try {
      const body = await readJson<ChatRequestBody>(request)
      const query = body.query?.trim()
      if (!query) return badRequest('query is required')

      // session can come from header or body
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

      return json({ ok: true, result: { ...chat.result, session_id: chat.session_id }, traceId: chat.traceId })
    } catch (err) {
      return toErrorResponse(err)
    }
  }

  return json({ ok: false, error: { code: 'bad_request', message: 'Not found' } }, { status: 404 })
}






