const PHOTOS_UPLOADS_URL = 'https://photoslibrary.googleapis.com/v1/uploads'
const PHOTOS_BATCH_CREATE_URL = 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate'
const MAX_DESCRIPTION_LENGTH = 1000

export class GooglePhotosApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'GooglePhotosApiError'
  }
}

function parseJsonDetail(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const googleError = (payload as { error?: { message?: unknown } }).error
  if (typeof googleError?.message === 'string' && googleError.message.trim()) {
    return googleError.message.trim()
  }

  const message = (payload as { message?: unknown }).message
  if (typeof message === 'string' && message.trim()) {
    return message.trim()
  }

  return null
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get('content-type') || ''
  const rawText = (await response.text()).trim()
  if (!rawText) {
    return undefined
  }

  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(rawText) as unknown
      const detail = parseJsonDetail(parsed)
      if (detail) {
        return detail
      }
    } catch {
      return rawText.slice(0, 300)
    }
  }

  return rawText.slice(0, 300)
}

function asContentType(value: string | null): string {
  if (!value) {
    return 'application/octet-stream'
  }

  return value.split(';')[0]?.trim() || 'application/octet-stream'
}

function normalizeDescription(value: string): string {
  if (value.length <= MAX_DESCRIPTION_LENGTH) {
    return value
  }

  return value.slice(0, MAX_DESCRIPTION_LENGTH)
}

export function buildUploadDescription(sourceUrl: string, pageUrl?: string | null): string {
  const normalizedPageUrl = pageUrl?.trim()
  if (!normalizedPageUrl || normalizedPageUrl === sourceUrl) {
    return normalizeDescription(sourceUrl)
  }

  return normalizeDescription(`${sourceUrl}\n\nSaved from: ${normalizedPageUrl}`)
}

async function uploadRawBytes(params: {
  accessToken: string
  bytes: Uint8Array
  fileName: string
  contentType: string | null
}): Promise<string> {
  const payload = Uint8Array.from(params.bytes)

  const response = await fetch(PHOTOS_UPLOADS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-Content-Type': asContentType(params.contentType),
      'X-Goog-Upload-File-Name': params.fileName
    },
    body: payload
  })

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new GooglePhotosApiError(
      `Google Photos byte upload failed (${response.status})${detail ? `: ${detail}` : '.'}`,
      response.status,
      detail
    )
  }

  const token = (await response.text()).trim()
  if (!token) {
    throw new Error('Google Photos byte upload returned empty token.')
  }

  return token
}

async function createMediaItem(params: {
  accessToken: string
  uploadToken: string
  fileName: string
  sourceUrl: string
  pageUrl: string | null
}): Promise<string> {
  const response = await fetch(PHOTOS_BATCH_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      newMediaItems: [
        {
          description: buildUploadDescription(params.sourceUrl, params.pageUrl),
          simpleMediaItem: {
            uploadToken: params.uploadToken,
            fileName: params.fileName
          }
        }
      ]
    })
  })

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    throw new GooglePhotosApiError(
      `Google Photos media item create failed (${response.status})${detail ? `: ${detail}` : '.'}`,
      response.status,
      detail
    )
  }

  const payload = (await response.json()) as {
    newMediaItemResults?: Array<{
      uploadToken?: string
      status?: {
        code?: number
        message?: string
      }
      mediaItem?: {
        id?: string
      }
    }>
  }

  const result = payload.newMediaItemResults?.[0]
  if (!result) {
    throw new Error('Google Photos media item create returned no result.')
  }

  const code = result.status?.code
  if (typeof code === 'number' && code !== 0) {
    throw new Error(`Google Photos media item create error (${code}): ${result.status?.message || 'unknown'}`)
  }

  return result.mediaItem?.id || 'unknown'
}

export async function uploadImageToGooglePhotos(params: {
  accessToken: string
  bytes: Uint8Array
  fileName: string
  contentType: string | null
  sourceUrl: string
  pageUrl: string | null
}): Promise<{ mediaItemId: string }> {
  const uploadToken = await uploadRawBytes({
    accessToken: params.accessToken,
    bytes: params.bytes,
    fileName: params.fileName,
    contentType: params.contentType
  })

  const mediaItemId = await createMediaItem({
    accessToken: params.accessToken,
    uploadToken,
    fileName: params.fileName,
    sourceUrl: params.sourceUrl,
    pageUrl: params.pageUrl
  })

  return { mediaItemId }
}
