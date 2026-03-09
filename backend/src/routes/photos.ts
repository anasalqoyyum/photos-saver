import { base64ToBytes as decodeBase64ToBytes } from '../base64.js'
import { AppConfig } from '../config.js'
import { errorResponse, jsonResponse, parseBearerToken, readJsonBody } from '../http.js'
import { GooglePhotosApiError, uploadImageToGooglePhotos } from '../services/google-photos.js'
import { refreshGoogleAccessToken } from '../services/google-oauth.js'
import { GoogleTokenStore, SessionStore } from '../store.js'

interface UploadRequestBody {
  imageBase64: string
  fileName: string
  sourceUrl: string
  contentType: string | null
}

export interface PhotosRoutesOptions {
  config: AppConfig
  sessionStore: SessionStore
  googleTokenStore: GoogleTokenStore
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const MAX_FILENAME_LENGTH = 255
const MAX_SOURCE_URL_LENGTH = 4096
const MAX_CONTENT_TYPE_LENGTH = 255
const GOOGLE_PHOTOS_APPENDONLY_SCOPE = 'https://www.googleapis.com/auth/photoslibrary.appendonly'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): boolean {
  return Object.keys(value).every(key => allowedKeys.includes(key))
}

function validateUploadBody(
  body: unknown,
  maxUploadBytes: number
):
  | { ok: true; value: UploadRequestBody }
  | {
      ok: false
      error:
        | 'INVALID_UPLOAD_BODY'
        | 'UNEXPECTED_UPLOAD_FIELDS'
        | 'MISSING_UPLOAD_FIELDS'
        | 'INVALID_CONTENT_TYPE'
        | 'IMAGE_PAYLOAD_TOO_LARGE'
    } {
  if (!isPlainObject(body)) {
    return { ok: false, error: 'INVALID_UPLOAD_BODY' }
  }

  const allowedKeys = ['imageBase64', 'fileName', 'sourceUrl', 'contentType'] as const
  if (!hasOnlyAllowedKeys(body, allowedKeys)) {
    return { ok: false, error: 'UNEXPECTED_UPLOAD_FIELDS' }
  }

  if (
    typeof body.imageBase64 !== 'string' ||
    typeof body.fileName !== 'string' ||
    typeof body.sourceUrl !== 'string'
  ) {
    return { ok: false, error: 'MISSING_UPLOAD_FIELDS' }
  }

  const imageBase64 = body.imageBase64
  const fileName = body.fileName.trim()
  const sourceUrl = body.sourceUrl.trim()

  if (!imageBase64 || !fileName || !sourceUrl) {
    return { ok: false, error: 'MISSING_UPLOAD_FIELDS' }
  }

  if (fileName.length > MAX_FILENAME_LENGTH || sourceUrl.length > MAX_SOURCE_URL_LENGTH) {
    return { ok: false, error: 'INVALID_UPLOAD_BODY' }
  }

  const contentTypeRaw = body.contentType
  if (
    contentTypeRaw !== undefined &&
    contentTypeRaw !== null &&
    typeof contentTypeRaw !== 'string'
  ) {
    return { ok: false, error: 'INVALID_CONTENT_TYPE' }
  }

  const contentType = contentTypeRaw ? contentTypeRaw.trim() : null
  if (contentType && contentType.length > MAX_CONTENT_TYPE_LENGTH) {
    return { ok: false, error: 'INVALID_CONTENT_TYPE' }
  }

  const maxBase64Length = Math.ceil((maxUploadBytes * 4) / 3) + 4
  if (imageBase64.length > maxBase64Length) {
    return { ok: false, error: 'IMAGE_PAYLOAD_TOO_LARGE' }
  }

  return {
    ok: true,
    value: {
      imageBase64,
      fileName,
      sourceUrl,
      contentType
    }
  }
}

function base64ToBytes(base64: string): Uint8Array | null {
  if (!BASE64_PATTERN.test(base64)) {
    return null
  }

  try {
    return decodeBase64ToBytes(base64)
  } catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return parsed
}

function hasGoogleScope(scopeList: string | undefined, requiredScope: string): boolean {
  if (!scopeList) {
    return false
  }

  return scopeList
    .split(' ')
    .map(scope => scope.trim())
    .filter(Boolean)
    .includes(requiredScope)
}

export async function handlePhotoUpload(
  request: Request,
  options: PhotosRoutesOptions
): Promise<Response> {
  const bearerToken = parseBearerToken(request.headers.get('authorization') || undefined)
  if (!bearerToken) {
    return errorResponse(401, 'MISSING_AUTHORIZATION')
  }

  const session = await options.sessionStore.get(bearerToken)
  if (!session) {
    return errorResponse(401, 'INVALID_OR_EXPIRED_SESSION')
  }

  const contentLength = parseContentLength(request.headers.get('content-length'))
  if (contentLength !== null && contentLength > options.config.maxUploadBytes * 2) {
    return errorResponse(413, 'IMAGE_TOO_LARGE', {
      maxBytes: options.config.maxUploadBytes
    })
  }

  const body = await readJsonBody(request)
  const validated = validateUploadBody(body, options.config.maxUploadBytes)
  if (!validated.ok) {
    if (validated.error === 'IMAGE_PAYLOAD_TOO_LARGE') {
      return errorResponse(413, 'IMAGE_TOO_LARGE', {
        maxBytes: options.config.maxUploadBytes
      })
    }

    return errorResponse(400, validated.error)
  }

  const { fileName, sourceUrl, imageBase64, contentType } = validated.value

  if (!isHttpUrl(sourceUrl)) {
    return errorResponse(400, 'INVALID_SOURCE_URL')
  }

  const bytes = base64ToBytes(imageBase64)
  if (!bytes) {
    return errorResponse(400, 'INVALID_IMAGE_BASE64')
  }

  if (bytes.byteLength === 0) {
    return errorResponse(400, 'EMPTY_IMAGE_PAYLOAD')
  }

  if (bytes.byteLength > options.config.maxUploadBytes) {
    return errorResponse(413, 'IMAGE_TOO_LARGE', {
      maxBytes: options.config.maxUploadBytes
    })
  }

  const storedGoogleToken = await options.googleTokenStore.getByUserId(session.userId)
  if (!storedGoogleToken) {
    return errorResponse(401, 'USER_NOT_LINKED_TO_GOOGLE')
  }

  if (
    storedGoogleToken.scope &&
    !hasGoogleScope(storedGoogleToken.scope, GOOGLE_PHOTOS_APPENDONLY_SCOPE)
  ) {
    return errorResponse(403, 'GOOGLE_SCOPE_MISSING', {
      detail:
        'Stored Google authorization is missing Google Photos append scope. Re-link the backend Google account.',
      grantedScope: storedGoogleToken.scope,
      requiredScope: GOOGLE_PHOTOS_APPENDONLY_SCOPE
    })
  }

  const refreshed = await refreshGoogleAccessToken({
    config: options.config,
    refreshToken: storedGoogleToken.refreshToken
  })

  const accessToken = refreshed.access_token
  if (!accessToken) {
    return errorResponse(502, 'GOOGLE_REFRESH_RETURNED_NO_ACCESS_TOKEN')
  }

  if (refreshed.refresh_token) {
    await options.googleTokenStore.upsert({
      ...storedGoogleToken,
      refreshToken: refreshed.refresh_token,
      ...(refreshed.scope ? { scope: refreshed.scope } : {}),
      updatedAt: Date.now()
    })
  }

  if (refreshed.scope && !hasGoogleScope(refreshed.scope, GOOGLE_PHOTOS_APPENDONLY_SCOPE)) {
    return errorResponse(403, 'GOOGLE_SCOPE_MISSING', {
      detail:
        'Refreshed Google access token is missing Google Photos append scope. Re-link the backend Google account.',
      grantedScope: refreshed.scope,
      requiredScope: GOOGLE_PHOTOS_APPENDONLY_SCOPE
    })
  }

  try {
    const uploadResult = await uploadImageToGooglePhotos({
      accessToken,
      bytes,
      fileName,
      contentType,
      sourceUrl
    })

    return jsonResponse({
      status: 'ok',
      fileName,
      mediaItemId: uploadResult.mediaItemId
    })
  } catch (error) {
    if (error instanceof GooglePhotosApiError) {
      return errorResponse(502, 'GOOGLE_PHOTOS_UPLOAD_FAILED', {
        detail: error.detail || error.message,
        googleStatus: error.status
      })
    }

    throw error
  }
}
