import { FastifyInstance } from 'fastify'

import { AppConfig } from '../config.js'
import { parseBearerToken } from '../http.js'
import {
  AuthStateStore,
  ExchangeCodeStore,
  GoogleTokenStore,
  SessionStore
} from '../store.js'
import {
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  extractGoogleUserId
} from '../services/google-oauth.js'

interface AuthRoutesOptions {
  config: AppConfig
  authStateStore: AuthStateStore
  exchangeCodeStore: ExchangeCodeStore
  sessionStore: SessionStore
  googleTokenStore: GoogleTokenStore
}

function isValidExtensionRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.chromiumapp.org')
  } catch {
    return false
  }
}

function withParam(baseUrl: string, key: string, value: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set(key, value)
  return url.toString()
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions
): Promise<void> {
  app.post<{ Body: { extensionRedirectUri: string } }>(
    '/v1/auth/start',
    async (request, reply) => {
      const extensionRedirectUri = request.body?.extensionRedirectUri?.trim()
      if (!extensionRedirectUri || !isValidExtensionRedirectUri(extensionRedirectUri)) {
        return reply.code(400).send({
          error: 'INVALID_EXTENSION_REDIRECT_URI'
        })
      }

      const state = crypto.randomUUID()
      const createdAt = Date.now()
      await options.authStateStore.create({
        state,
        extensionRedirectUri,
        createdAt,
        expiresAt: createdAt + options.config.authStateTtlMs
      })

      const authUrl = buildGoogleAuthUrl({
        config: options.config,
        state
      })

      return {
        authUrl,
        state
      }
    }
  )

  app.get<{
    Querystring: {
      code?: string
      state?: string
      error?: string
      error_description?: string
    }
  }>('/v1/auth/callback', async (request, reply) => {
    if (request.query.error) {
      return reply.code(400).send({
        error: 'OAUTH_PROVIDER_ERROR',
        detail: request.query.error_description || request.query.error
      })
    }

    const state = request.query.state || ''
    const code = request.query.code || ''
    if (!state || !code) {
      return reply.code(400).send({
        error: 'INVALID_CALLBACK_PARAMS'
      })
    }

    const authState = await options.authStateStore.consume(state)
    if (!authState) {
      return reply.code(400).send({
        error: 'INVALID_OR_EXPIRED_STATE'
      })
    }

    const tokenPayload = await exchangeGoogleAuthCode({
      config: options.config,
      code
    })

    const userId = extractGoogleUserId(tokenPayload.id_token)
    if (!userId) {
      return reply.code(400).send({
        error: 'MISSING_USER_ID_IN_ID_TOKEN'
      })
    }

    if (options.config.allowedGoogleUserId && options.config.allowedGoogleUserId !== userId) {
      return reply.code(403).send({
        error: 'GOOGLE_USER_NOT_ALLOWED'
      })
    }

    const existing = await options.googleTokenStore.getByUserId(userId)
    const refreshToken = tokenPayload.refresh_token || existing?.refreshToken
    if (!refreshToken) {
      return reply.code(400).send({
        error: 'MISSING_REFRESH_TOKEN',
        detail: 'Google did not return refresh_token and no existing token is stored.'
      })
    }

    await options.googleTokenStore.upsert({
      userId,
      refreshToken,
      ...(tokenPayload.scope ? { scope: tokenPayload.scope } : {}),
      updatedAt: Date.now()
    })

    const exchangeCode = await options.exchangeCodeStore.create(
      userId,
      options.config.exchangeCodeTtlMs
    )

    return reply.redirect(
      withParam(authState.extensionRedirectUri, 'session_code', exchangeCode.code)
    )
  })

  app.post<{ Body: { sessionCode: string } }>(
    '/v1/auth/exchange',
    async (request, reply) => {
      const sessionCode = request.body?.sessionCode?.trim()
      if (!sessionCode) {
        return reply.code(400).send({
          error: 'MISSING_SESSION_CODE'
        })
      }

      const exchangeCode = await options.exchangeCodeStore.consume(sessionCode)
      if (!exchangeCode) {
        return reply.code(401).send({
          error: 'INVALID_OR_EXPIRED_SESSION_CODE'
        })
      }

      const session = await options.sessionStore.create(
        exchangeCode.userId,
        options.config.sessionTtlMs
      )

      return {
        sessionToken: session.token,
        expiresAt: session.expiresAt
      }
    }
  )

  app.post('/v1/auth/logout', async (request, reply) => {
    const token = parseBearerToken(request.headers.authorization)
    if (!token) {
      return reply.code(401).send({ error: 'MISSING_AUTHORIZATION' })
    }

    await options.sessionStore.revoke(token)
    return reply.code(204).send()
  })
}
