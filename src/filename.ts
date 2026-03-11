import { MAX_DESCRIPTION_LENGTH, MAX_FILENAME_LENGTH } from './constants.js'

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g
const LEADING_DOTS = /^\.+/

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif'
}

function parseContentDispositionFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) {
    return null
  }

  const filenameStarMatch = contentDisposition.match(/filename\*=([^;]+)/i)
  if (filenameStarMatch?.[1]) {
    const rawValue = filenameStarMatch[1].trim()
    const parts = rawValue.split("''")
    const encodedName = parts.length > 1 ? parts.slice(1).join("''") : rawValue
    const cleaned = encodedName.replace(/^"|"$/g, '')
    try {
      return decodeURIComponent(cleaned)
    } catch {
      return cleaned
    }
  }

  const filenameMatch = contentDisposition.match(/filename=([^;]+)/i)
  if (!filenameMatch?.[1]) {
    return null
  }

  return filenameMatch[1].trim().replace(/^"|"$/g, '')
}

function filenameFromUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url)
    const pathPart = parsedUrl.pathname.split('/').filter(Boolean).pop()
    if (!pathPart) {
      return null
    }

    return decodeURIComponent(pathPart)
  } catch {
    return null
  }
}

function extensionFromMime(contentType: string | null): string | null {
  if (!contentType) {
    return null
  }

  const mime = contentType.split(';')[0]?.trim().toLowerCase()
  if (!mime) {
    return null
  }

  return EXT_BY_MIME[mime] ?? null
}

export function sanitizeFilename(name: string): string {
  // Strip ASCII control characters (code points 0–31) to avoid quadratic-time concatenation in a loop.
  // oxlint-disable-next-line no-control-regex
 const noControlChars = name.replace(/[\x00-\x1F]/g, '')

  const cleaned = noControlChars.replace(ILLEGAL_FILENAME_CHARS, '_').replace(LEADING_DOTS, '').trim()

  if (!cleaned) {
    return 'image'
  }

  return cleaned.slice(0, MAX_FILENAME_LENGTH)
}

export function ensureExtension(filename: string, contentType: string | null): string {
  if (filename.includes('.')) {
    return filename
  }

  const ext = extensionFromMime(contentType)
  if (!ext) {
    return filename
  }

  return `${filename}.${ext}`
}

export function resolveFilename(params: { sourceUrl: string; contentDisposition: string | null; contentType: string | null }): string {
  const fromDisposition = parseContentDispositionFilename(params.contentDisposition)
  const fromUrl = filenameFromUrl(params.sourceUrl)
  const fallback = `image-${Date.now()}`

  const base = fromDisposition ?? fromUrl ?? fallback
  return ensureExtension(sanitizeFilename(base), params.contentType)
}

export function normalizeDescription(sourceUrl: string): string {
  if (sourceUrl.length <= MAX_DESCRIPTION_LENGTH) {
    return sourceUrl
  }

  return sourceUrl.slice(0, MAX_DESCRIPTION_LENGTH)
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function buildDescription(sourceUrl: string, pageUrl?: string | null): string {
  const normalizedPageUrl = pageUrl?.trim()
  if (!normalizedPageUrl || normalizedPageUrl === sourceUrl || !isHttpUrl(normalizedPageUrl)) {
    return normalizeDescription(sourceUrl)
  }

  return normalizeDescription(`${sourceUrl}\n\nSaved from: ${normalizedPageUrl}`)
}
