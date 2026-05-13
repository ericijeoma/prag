import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
  if (!env.SUPABASE_URL) throw new Error('Missing env.SUPABASE_URL')
  if (!env.SUPABASE_SECRET_KEY) throw new Error('Missing env.SUPABASE_SECRET_KEY')

  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}