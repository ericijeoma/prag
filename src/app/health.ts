import type { SupabaseClient } from '@supabase/supabase-js'

import { HealthRepository } from '../infrastructure/supabase/health-repository.js'

export type HealthReport = {
  ok: boolean
  timestamp: string
  bindings: {
    ai: boolean
    groqApiKey: boolean
    supabaseUrl: boolean
    supabaseSecretKey: boolean
  }
  supabase: {
    ok: boolean
    details?: unknown
  }
}

export async function buildHealthReport(input: {
  env: {
    AI: unknown
    GROQ_API_KEY?: string
    SUPABASE_URL?: string
    SUPABASE_SECRET_KEY?: string
  }
  supabase?: SupabaseClient
}): Promise<HealthReport> {
  const bindings = {
    ai: Boolean(input.env.AI),
    groqApiKey: Boolean(input.env.GROQ_API_KEY),
    supabaseUrl: Boolean(input.env.SUPABASE_URL),
    supabaseSecretKey: Boolean(input.env.SUPABASE_SECRET_KEY),
  }

  const report: HealthReport = {
    ok: false,
    timestamp: new Date().toISOString(),
    bindings,
    supabase: { ok: false },
  }

  if (!input.supabase) {
    report.ok = false
    report.supabase = { ok: false, details: { reason: 'supabase_client_unavailable' } }
    return report
  }

  const repo = new HealthRepository(input.supabase)
  const db = await repo.healthcheck()
  report.supabase = { ok: db.ok, details: db }
  report.ok = bindings.ai && bindings.groqApiKey && bindings.supabaseUrl && bindings.supabaseSecretKey && db.ok
  return report
}
