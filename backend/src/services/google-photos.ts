const PHOTOS_UPLOADS_URL = 'https://photoslibrary.googleapis.com/v1/uploads'
const PHOTOS_BATCH_CREATE_URL =
  'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate'

function asContentType(value: string | null): string {
  if (!value) {
    return 'application/octet-stream'
  }

  return value.split(';')[0]?.trim() || 'application/octet-stream'
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
    throw new Error(`Google Photos byte upload failed (${response.status}).`)
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
          description: params.sourceUrl,
          simpleMediaItem: {
            uploadToken: params.uploadToken,
            fileName: params.fileName
          }
        }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`Google Photos media item create failed (${response.status}).`)
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
    throw new Error(
      `Google Photos media item create error (${code}): ${result.status?.message || 'unknown'}`
    )
  }

  return result.mediaItem?.id || 'unknown'
}

export async function uploadImageToGooglePhotos(params: {
  accessToken: string
  bytes: Uint8Array
  fileName: string
  contentType: string | null
  sourceUrl: string
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
    sourceUrl: params.sourceUrl
  })

  return { mediaItemId }
}
