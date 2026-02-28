import { FastifyInstance, InjectOptions } from 'fastify'

import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { WorkerBindings } from './worker-bindings.js'

let appPromise: Promise<FastifyInstance> | null = null

function toInjectMethod(method: string): NonNullable<InjectOptions['method']> {
  return method as NonNullable<InjectOptions['method']>
}

function getApp(env: Record<string, unknown>): Promise<FastifyInstance> {
  if (!appPromise) {
    const normalizedEnv: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string') {
        normalizedEnv[key] = value
      }
    }

    const bindings: WorkerBindings = {
      ...(env.APP_DB
        ? { APP_DB: env.APP_DB as NonNullable<WorkerBindings['APP_DB']> }
        : {}),
      ...(env.AUTH_KV
        ? { AUTH_KV: env.AUTH_KV as NonNullable<WorkerBindings['AUTH_KV']> }
        : {})
    }

    const config = loadConfig(normalizedEnv)
    appPromise = buildApp(config, bindings, { logger: false })
  }

  return appPromise
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown error'
}

function jsonError(status: number, error: string, detail?: string): Response {
  return new Response(
    JSON.stringify({
      error,
      ...(detail ? { detail } : {})
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8'
      }
    }
  )
}

interface RequestLogEntry {
  method: string
  path: string
  hasQuery: boolean
  status: number
  durationMs: number
  outcome: 'ok' | 'startup_error' | 'handler_error'
  cfRay?: string
}

function logRequest(entry: RequestLogEntry): void {
  console.log('Worker request', entry)
}

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const url = new URL(request.url)
    const startedAt = Date.now()
    const cfRay = request.headers.get('cf-ray') || undefined

    let app: FastifyInstance
    try {
      app = await getApp(env)
    } catch (error) {
      const detail = errorMessage(error)
      console.error('Worker startup failed.', error)
      logRequest({
        method: request.method,
        path: url.pathname,
        hasQuery: url.search.length > 0,
        status: 500,
        durationMs: Date.now() - startedAt,
        outcome: 'startup_error',
        ...(cfRay ? { cfRay } : {})
      })
      return jsonError(500, 'WORKER_STARTUP_FAILED', detail)
    }

    const headers = Object.fromEntries(request.headers.entries())
    const injectOptions: InjectOptions = {
      method: toInjectMethod(request.method),
      url: `${url.pathname}${url.search}`,
      headers
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      injectOptions.payload = Buffer.from(await request.arrayBuffer())
    }

    try {
      const response = await app.inject(injectOptions)

      logRequest({
        method: request.method,
        path: url.pathname,
        hasQuery: url.search.length > 0,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
        outcome: 'ok',
        ...(cfRay ? { cfRay } : {})
      })

      return new Response(response.payload, {
        status: response.statusCode,
        headers: response.headers as HeadersInit
      })
    } catch (error) {
      const detail = errorMessage(error)
      console.error('Worker request handling failed.', error)
      logRequest({
        method: request.method,
        path: url.pathname,
        hasQuery: url.search.length > 0,
        status: 500,
        durationMs: Date.now() - startedAt,
        outcome: 'handler_error',
        ...(cfRay ? { cfRay } : {})
      })
      return jsonError(500, 'WORKER_REQUEST_FAILED', detail)
    }
  }
}
