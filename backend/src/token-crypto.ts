import { base64UrlToBytes, bytesToBase64Url } from './base64.js'

function decodeKeyMaterial(value: string): Uint8Array {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('TOKEN_ENCRYPTION_KEY is empty.')
  }

  const decoded = base64UrlToBytes(trimmed)
  if (decoded.byteLength === 0) {
    throw new Error('TOKEN_ENCRYPTION_KEY could not be decoded.')
  }

  return decoded
}

export class TokenCipher {
  private readonly key: CryptoKey

  private constructor(key: CryptoKey) {
    this.key = key
  }

  static async fromSecret(secret: string): Promise<TokenCipher> {
    const keyBytes = decodeKeyMaterial(secret)
    if (keyBytes.byteLength !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM.')
    }

    const normalizedKey = Uint8Array.from(keyBytes)

    const key = await crypto.subtle.importKey(
      'raw',
      normalizedKey,
      {
        name: 'AES-GCM'
      },
      false,
      ['encrypt', 'decrypt']
    )

    return new TokenCipher(key)
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(plaintext)
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      this.key,
      encoded
    )

    return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`
  }

  async decrypt(payload: string): Promise<string> {
    const [ivPart, dataPart] = payload.split('.')
    if (!ivPart || !dataPart) {
      throw new Error('Encrypted payload has invalid format.')
    }

    const iv = Uint8Array.from(base64UrlToBytes(ivPart))
    const data = Uint8Array.from(base64UrlToBytes(dataPart))
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv
      },
      this.key,
      data
    )

    return new TextDecoder().decode(plaintext)
  }
}
