import { handleRequest, type AppEnv } from './app/routes.js'

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    return handleRequest(request, env)
  },
} satisfies ExportedHandler<AppEnv>
