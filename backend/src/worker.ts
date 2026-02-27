import { FastifyInstance, InjectOptions } from 'fastify'

import { buildApp } from './app.js'
import { loadConfig } from './config.js'

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

    const config = loadConfig(normalizedEnv)
    appPromise = buildApp(config)
  }

  return appPromise
}

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    const app = await getApp(env)

    const url = new URL(request.url)
    const headers = Object.fromEntries(request.headers.entries())
    const injectOptions: InjectOptions = {
      method: toInjectMethod(request.method),
      url: `${url.pathname}${url.search}`,
      headers
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      injectOptions.payload = Buffer.from(await request.arrayBuffer())
    }

    const response = await app.inject(injectOptions)

    return new Response(response.payload, {
      status: response.statusCode,
      headers: response.headers as HeadersInit
    })
  }
}
