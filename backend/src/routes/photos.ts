import { FastifyInstance } from 'fastify'

import { AppConfig } from '../config.js'
import { parseBearerToken } from '../http.js'
import { uploadImageToGooglePhotos } from '../services/google-photos.js'
import { refreshGoogleAccessToken } from '../services/google-oauth.js'
import { GoogleTokenStore, SessionStore } from '../store.js'

interface UploadRequestBody {
  imageBase64: string
  fileName: string
  sourceUrl: string
  contentType: string | null
}

interface PhotosRoutesOptions {
  config: AppConfig
  sessionStore: SessionStore
  googleTokenStore: GoogleTokenStore
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(base64, 'base64'))
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function registerPhotosRoutes(
  app: FastifyInstance,
  options: PhotosRoutesOptions
): Promise<void> {
  app.post<{ Body: UploadRequestBody }>(
    '/v1/photos/upload',
    async (request, reply) => {
      const bearerToken = parseBearerToken(request.headers.authorization)
      if (!bearerToken) {
        return reply.code(401).send({ error: 'MISSING_AUTHORIZATION' })
      }

      const session = await options.sessionStore.get(bearerToken)
      if (!session) {
        return reply.code(401).send({ error: 'INVALID_OR_EXPIRED_SESSION' })
      }

      const fileName = request.body?.fileName?.trim()
      const sourceUrl = request.body?.sourceUrl?.trim()
      const imageBase64 = request.body?.imageBase64
      const contentType = request.body?.contentType || null

      if (!fileName || !sourceUrl || !imageBase64) {
        return reply.code(400).send({ error: 'MISSING_UPLOAD_FIELDS' })
      }

      if (!isHttpUrl(sourceUrl)) {
        return reply.code(400).send({ error: 'INVALID_SOURCE_URL' })
      }

      const bytes = base64ToBytes(imageBase64)
      if (bytes.byteLength === 0) {
        return reply.code(400).send({ error: 'EMPTY_IMAGE_PAYLOAD' })
      }

      if (bytes.byteLength > options.config.maxUploadBytes) {
        return reply.code(413).send({
          error: 'IMAGE_TOO_LARGE',
          maxBytes: options.config.maxUploadBytes
        })
      }

      const storedGoogleToken = await options.googleTokenStore.getByUserId(
        session.userId
      )
      if (!storedGoogleToken) {
        return reply.code(401).send({ error: 'USER_NOT_LINKED_TO_GOOGLE' })
      }

      const refreshed = await refreshGoogleAccessToken({
        config: options.config,
        refreshToken: storedGoogleToken.refreshToken
      })

      const accessToken = refreshed.access_token
      if (!accessToken) {
        return reply.code(502).send({ error: 'GOOGLE_REFRESH_RETURNED_NO_ACCESS_TOKEN' })
      }

      if (refreshed.refresh_token) {
        await options.googleTokenStore.upsert({
          ...storedGoogleToken,
          refreshToken: refreshed.refresh_token,
          ...(refreshed.scope ? { scope: refreshed.scope } : {}),
          updatedAt: Date.now()
        })
      }

      const uploadResult = await uploadImageToGooglePhotos({
        accessToken,
        bytes,
        fileName,
        contentType,
        sourceUrl
      })

      return {
        status: 'ok',
        fileName,
        mediaItemId: uploadResult.mediaItemId
      }
    }
  )
}
