interface Env {
  GROQ_API_KEY: string;
  SUPABASE_SECRET_KEY: string;
}

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}