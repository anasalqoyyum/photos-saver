import { PHOTOS_BATCH_CREATE_URL, PHOTOS_UPLOADS_URL } from './constants.js'
import { ExtensionError } from './errors.js'
import { debug, warn } from './logger.js'

export interface UploadInput {
  token: string
  bytes: ArrayBuffer
  fileName: string
  contentType: string | null
  description: string
}

function asContentType(value: string | null): string {
  if (!value) {
    return 'application/octet-stream'
  }

  return value.split(';')[0]?.trim() || 'application/octet-stream'
}

export async function uploadBytes(input: UploadInput): Promise<string> {
  debug('Uploading image bytes to Google Photos.', {
    fileName: input.fileName,
    contentType: asContentType(input.contentType),
    bytes: input.bytes.byteLength
  })

  const response = await fetch(PHOTOS_UPLOADS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-Content-Type': asContentType(input.contentType),
      'X-Goog-Upload-File-Name': input.fileName
    },
    body: input.bytes
  })

  if (response.status === 401) {
    warn('Google Photos upload rejected OAuth token.', {
      fileName: input.fileName
    })
    throw new ExtensionError(
      'AUTH_FAILED',
      'OAuth token was rejected by Google Photos.'
    )
  }

  if (!response.ok) {
    warn('Google Photos byte upload failed.', {
      fileName: input.fileName,
      status: response.status
    })
    throw new ExtensionError(
      'UPLOAD_FAILED',
      `Upload bytes failed with status ${response.status}.`
    )
  }

  const uploadToken = (await response.text()).trim()
  if (!uploadToken) {
    warn('Google Photos returned empty upload token.', {
      fileName: input.fileName
    })
    throw new ExtensionError(
      'UPLOAD_FAILED',
      'Google Photos did not return an upload token.'
    )
  }

  debug('Google Photos byte upload completed.', {
    fileName: input.fileName
  })
  return uploadToken
}

export async function createMediaItem(input: {
  token: string
  uploadToken: string
  fileName: string
  description: string
}): Promise<void> {
  debug('Creating Google Photos media item.', {
    fileName: input.fileName,
    descriptionLength: input.description.length
  })

  const response = await fetch(PHOTOS_BATCH_CREATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      newMediaItems: [
        {
          description: input.description,
          simpleMediaItem: {
            uploadToken: input.uploadToken,
            fileName: input.fileName
          }
        }
      ]
    })
  })

  if (response.status === 401) {
    warn('Google Photos create rejected OAuth token.', {
      fileName: input.fileName
    })
    throw new ExtensionError(
      'AUTH_FAILED',
      'OAuth token was rejected by Google Photos.'
    )
  }

  if (!response.ok) {
    warn('Google Photos media item creation failed.', {
      fileName: input.fileName,
      status: response.status
    })
    throw new ExtensionError(
      'CREATE_FAILED',
      `Batch create failed with status ${response.status}.`
    )
  }

  const payload = (await response.json()) as {
    newMediaItemResults?: Array<{
      status?: {
        code?: number
        message?: string
      }
    }>
  }

  const firstResult = payload.newMediaItemResults?.[0]
  if (!firstResult) {
    warn('Google Photos batchCreate returned no item results.', {
      fileName: input.fileName
    })
    throw new ExtensionError(
      'CREATE_FAILED',
      'No media item result returned by Google Photos.'
    )
  }

  const statusCode = firstResult.status?.code
  if (typeof statusCode === 'number' && statusCode !== 0) {
    const message =
      firstResult.status?.message || 'Unknown Google Photos create error.'
    warn('Google Photos returned media item creation status error.', {
      fileName: input.fileName,
      statusCode,
      message
    })
    throw new ExtensionError('CREATE_FAILED', message)
  }

  debug('Google Photos media item created successfully.', {
    fileName: input.fileName
  })
}
