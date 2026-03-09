import { buildApp, WorkerApp } from './app.js'
import { loadConfig } from './config.js'
import { errorResponse } from './http.js'
import { WorkerBindings } from './worker-bindings.js'

type WorkerEnv = WorkerBindings & Record<string, unknown>

let appPromise: Promise<WorkerApp> | null = null

function normalizeEnv(env: WorkerEnv): Record<string, string | undefined> {
  const normalizedEnv: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      normalizedEnv[key] = value
    }
  }

  return normalizedEnv
}

function extractBindings(env: WorkerEnv): WorkerBindings {
  const bindings: WorkerBindings = {}

  if (env.APP_DB) {
    bindings.APP_DB = env.APP_DB
  }

  if (env.AUTH_KV) {
    bindings.AUTH_KV = env.AUTH_KV
  }

  return bindings
}

function getApp(env: WorkerEnv): Promise<WorkerApp> {
  if (!appPromise) {
    const config = loadConfig(normalizeEnv(env))
    appPromise = buildApp(config, extractBindings(env))
  }

  return appPromise
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      const app = await getApp(env)
      return app.fetch(request)
    } catch (error) {
      console.error('Worker startup failed.', error)
      return errorResponse(500, 'WORKER_STARTUP_FAILED', {
        detail: errorMessage(error)
      })
    }
  }
}
