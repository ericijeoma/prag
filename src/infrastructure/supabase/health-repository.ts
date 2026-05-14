import type { SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../../shared/http/errors.js'

export type DbHealth = {
  ok: boolean
  schemas: {
    shared: boolean
    ingestion: boolean
    knowledge: boolean
    agent: boolean
  }
  extensions: {
    pgvector: boolean
  }
  rpcs: Record<string, unknown>
}

export class HealthRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async healthcheck(): Promise<DbHealth> {
    const { data, error } = await this.supabase.rpc('prag_healthcheck')
    if (error) {
      throw new AppError('DB healthcheck RPC failed', {
        code: 'supabase_error',
        status: 500,
        details: { message: error.message, code: error.code, hint: error.hint, details: error.details },
      })
    }
    return data as DbHealth
  }
}
