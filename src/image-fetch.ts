import { ExtensionError } from './errors.js'
import { resolveFilename } from './filename.js'
import { debug, warn } from './logger.js'

export interface FetchedImage {
  bytes: ArrayBuffer
  contentType: string | null
  sourceUrl: string
  fileName: string
}

function isSupportedSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function fetchImageFromSource(
  sourceUrl: string
): Promise<FetchedImage> {
  debug('Starting image fetch.', { sourceUrl })

  if (!isSupportedSourceUrl(sourceUrl)) {
    warn('Rejected unsupported image URL protocol.', { sourceUrl })
    throw new ExtensionError(
      'INVALID_IMAGE_URL',
      'Unsupported image URL protocol.'
    )
  }

  let response: Response
  try {
    response = await fetch(sourceUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    })
  } catch (error) {
    warn('Image fetch failed before response.', {
      sourceUrl,
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    throw new ExtensionError(
      'FETCH_FAILED',
      error instanceof Error ? error.message : 'Image request failed.'
    )
  }

  if (!response.ok) {
    warn('Image fetch returned non-OK status.', {
      sourceUrl,
      status: response.status
    })
    throw new ExtensionError(
      'FETCH_FAILED',
      `Image request failed with status ${response.status}.`
    )
  }

  const contentType = response.headers.get('content-type')
  const contentDisposition = response.headers.get('content-disposition')
  const fileName = resolveFilename({
    sourceUrl,
    contentDisposition,
    contentType
  })

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength === 0) {
    warn('Image fetch returned empty payload.', { sourceUrl })
    throw new ExtensionError('FETCH_FAILED', 'Image response body was empty.')
  }

  debug('Image fetch completed.', {
    sourceUrl,
    fileName,
    contentType: contentType || 'unknown',
    bytes: bytes.byteLength
  })

  return {
    bytes,
    contentType,
    sourceUrl,
    fileName
  }
}
