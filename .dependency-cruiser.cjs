module.exports = {
  options: {
    tsConfig: {
      fileName: "./tsconfig.json",
    },
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "(^dist$|/dist/|^coverage$|/coverage/|^\\.wrangler/|^supabase/)",
    },
  },
  forbidden: [
    // ── Cross-feature boundary ──────────────────────────────────────
    // Features must never import each other directly. This is the
    // most important rule: it guarantees each feature is replaceable
    // without cascading side effects across the system.
    {
      name: "no-cross-feature-imports",
      severity: "error",
      from: { path: "^src/features/([^/]+)/" },
      to:   { path: "^src/features/", pathNot: "^src/features/$1/" },
    },

    // ── Domain layer rules ─────────────────────────────────────────
    // Domain must never know about infrastructure or api layers.
    // Domain logic must stay pure so it can be tested without a
    // database, LLM, or HTTP framework.
    {
      name: "domain-no-infrastructure",
      severity: "error",
      from: { path: "/domain/" },
      to:   { path: "/infrastructure/" },
    },
    {
      name: "domain-no-api",
      severity: "error",
      from: { path: "/domain/" },
      to:   { path: "/api/" },
    },

    // ── Application layer rules ────────────────────────────────────
    // Application orchestrates domain through interfaces only.
    // Direct infrastructure or api imports bypass the adapter
    // contract and make the layer untestable in isolation.
    {
      name: "application-no-infrastructure",
      severity: "error",
      from: { path: "/application/" },
      to:   { path: "/infrastructure/" },
    },
    {
      name: "application-no-api",
      severity: "error",
      from: { path: "/application/" },
      to:   { path: "/api/" },
    },

    // ── API layer rules ────────────────────────────────────────────
    // The api layer is a thin HTTP adapter. All logic must flow
    // through the application layer. Direct domain or infrastructure
    // imports mean business logic has leaked into the HTTP layer.
    {
      name: "api-no-domain-direct",
      severity: "error",
      from: { path: "/api/" },
      to:   { path: "/domain/" },
    },
    {
      name: "api-no-infrastructure-direct",
      severity: "error",
      from: { path: "/api/" },
      to:   { path: "/infrastructure/" },
    },

    // ── Infrastructure adapter rules ───────────────────────────────
    // All LLM calls must go through src/infrastructure/groq/ or
    // src/shared/llm/ so the provider is swappable without touching
    // any feature code.
    {
      name: "no-direct-llm-calls",
      severity: "error",
      from: { path: "^src/(?!infrastructure/groq|shared/llm)" },
      to:   { path: "groq-sdk|openai|@anthropic" },
    },

    // All Supabase access must go through src/infrastructure/supabase/
    // or src/shared/db/ so the storage layer is replaceable and
    // testable behind a repository interface.
    {
      name: "no-direct-supabase-calls",
      severity: "error",
      from: {
        path: "^src/",
        pathNot: "^src/(infrastructure/supabase|shared/db)",
      },
      to: { path: "@supabase/supabase-js|@supabase/postgrest-js" },
    },

    // ── Entrypoint rule ────────────────────────────────────────────
    // src/index.ts must only route requests. Domain logic in the
    // entrypoint increases cold-start cost and breaks separation
    // of concerns at the Worker boundary.
    {
      name: "thin-entrypoint",
      severity: "error",
      from: { path: "^src/index\\.ts$" },
      to: {
        path: "^src/features/[^/]+/(domain|application|infrastructure)/",
      },
    },
  ],
};