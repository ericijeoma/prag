import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { AppError } from '../../shared/http/errors.js'

/**
 * Cloudflare Workers env vars used by Supabase.
 *
 * SUPABASE_URL is a non-secret Wrangler var.
 * SUPABASE_SECRET_KEY must be stored as a Wrangler secret.
 */
export type SupabaseEnv = {
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

/**
 * Create a server-side Supabase client using the secret key.
 * Session persistence and token refresh are disabled because Workers are stateless.
 */
export function createSupabaseClient(env: SupabaseEnv): SupabaseClient {
  if (!env.SUPABASE_URL) {
    throw new AppError('Missing env.SUPABASE_URL', { code: 'missing_env', status: 500 })
  }
  if (!env.SUPABASE_SECRET_KEY) {
    throw new AppError('Missing env.SUPABASE_SECRET_KEY', { code: 'missing_env', status: 500 })
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    // Explicitly declare supported PostgREST schemas (non-public included).
    // This enables `.schema('knowledge')` / `.schema('agent')` etc.
    db: {
      schema: 'public',
    },
    global: {
      headers: {
        // Ensure PostgREST exposes these schemas for this client.
        // Supabase requires `db.schemas` config on the project side too;
        // but sending the header keeps intent explicit and works with multi-schema PostgREST.
        'Accept-Profile': 'public',
        'Content-Profile': 'public',
      },
    },
  })
}