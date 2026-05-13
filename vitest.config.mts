import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Pure unit tests — run in Node, no Workers runtime needed
      {
        test: {
          name: 'unit',
          include: ['test/chunking/**/*.test.ts'],
          environment: 'node',
        },
      },
      // Workers integration tests — run in Miniflare locally
      {
        extends: true,
        test: {
          name: 'workers',
          include: ['test/workers/**/*.test.ts'],
          ...defineWorkersConfig({
            test: {
              poolOptions: {
                workers: {
                  wrangler: { configPath: './wrangler.jsonc' },
                  miniflare: { envPath: true },
                  singleWorker: true,
                },
              },
            },
          }).test,
        },
      },
    ],
  },
})