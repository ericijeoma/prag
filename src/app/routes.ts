import { createSupabaseClient, type SupabaseEnv } from '../infrastructure/supabase/client.js'
import { IngestService } from '../features/ingestion/ingest-service.js'
import { SearchService } from '../features/retrieval/search-service.js'
import { AnswerService } from '../features/agent/answer-service.js'
import type { AiBinding } from '../features/ingestion/ingest-service.js'

type Json = Record<string, unknown>

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 })
}

function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, { status: 405 })
}

async function readJson<T extends Json>(req: Request): Promise<T> {
  const text = await req.text()
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export type AppEnv = SupabaseEnv & {
  AI: AiBinding
  GROQ_API_KEY: string
}

export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method.toUpperCase()

  if (method === 'GET' && path === '/health') {
    return json({ ok: true })
  }

  const supabase = createSupabaseClient(env)

  if (path === '/ingest') {
    if (method !== 'POST') return methodNotAllowed()
    const body = await readJson<{
      title?: string
      content?: string
      metadata?: Record<string, unknown>
      file_path?: string | null
      source_type?: string
    }>(request)

    if (!body.title || !body.content) return badRequest('title and content are required')

    const svc = new IngestService({ supabase, env })
    const result = await svc.ingest({
      title: body.title,
      content: body.content,
      metadata: body.metadata,
      file_path: body.file_path ?? null,
      source_type: body.source_type,
    })

    return json(result)
  }

  if (path === '/search') {
    if (method !== 'POST') return methodNotAllowed()
    const body = await readJson<{ query?: string }>(request)
    if (!body.query) return badRequest('query is required')

    const svc = new SearchService({ supabase, env })
    const result = await svc.search({ query: body.query, topK: 5 })
    return json(result)
  }

  if (path === '/answer') {
    if (method !== 'POST') return methodNotAllowed()
    const body = await readJson<{ query?: string }>(request)
    if (!body.query) return badRequest('query is required')

    const svc = new AnswerService({ supabase, env })
    const result = await svc.answer({ query: body.query })
    return json(result)
  }

  return json({ error: 'Not found' }, { status: 404 })
}
