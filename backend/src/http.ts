export function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null
  }

  const [scheme, token] = authorizationHeader.split(' ')
  if (!scheme || !token) {
    return null
  }

  if (scheme.toLowerCase() !== 'bearer') {
    return null
  }

  return token.trim() || null
}
