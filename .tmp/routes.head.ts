import { createSupabaseClient, type SupabaseEnv } from '../infrastructure/supabase/client.js'
import { IngestService } from '../features/ingestion/ingest-service.js'
import { SearchService } from '../features/retrieval/search-service.js'
import { AnswerService } from '../features/agent/answer-service.js'
import type { AiBinding } from '../features/ingestion/ingest-service.js'
import { buildHealthReport } from './health.js'
import { AppError, isAppError } from '../shared/http/errors.js'

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

export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

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
      const body = await readJson<{
        title?: string
        content?: string
        metadata?: Record<string, unknown>
        file_path?: string | null
        source_type?: string
      }>(request)

      if (!body.title || !body.content) return badRequest('title and content are required')

      const svc = new IngestService({ supabase: supabase!, env })
      const result = await svc.ingest({
        title: body.title,
        content: body.content,
        metadata: body.metadata,
        file_path: body.file_path ?? null,
        source_type: body.source_type,
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
      const result = await svc.search({ query: body.query, topK: 5 })
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

      const svc = new AnswerService({ supabase: supabase!, env })
      const result = await svc.answer({ query: body.query })
      return json({ ok: true, result })
    } catch (err) {
      return toErrorResponse(err)
    }
  }

  return json({ ok: false, error: { code: 'bad_request', message: 'Not found' } }, { status: 404 })
}
