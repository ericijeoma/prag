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
    {
      name: "domain-no-infra",
      severity: "error",
      from: {
        path: "/domain/",
      },
      to: {
        path: "/infrastructure/",
      },
    },
    {
      name: "domain-no-api",
      severity: "error",
      from: {
        path: "/domain/",
      },
      to: {
        path: "/api/",
      },
    },
    {
      name: "application-no-api",
      severity: "error",
      from: {
        path: "/application/",
      },
      to: {
        path: "/api/",
      },
    },
    {
      name: "infrastructure-no-api",
      severity: "error",
      from: {
        path: "/infrastructure/",
      },
      to: {
        path: "/api/",
      },
    },
  ],
};