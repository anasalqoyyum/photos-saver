const CHUNK_SIZE = 0x8000

function bytesToBinary(bytes: Uint8Array): string {
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }

  return binary
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes))
}

export function base64ToBytes(base64: string): Uint8Array {
  return binaryToBytes(atob(base64))
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return base64ToBytes(padded)
}
