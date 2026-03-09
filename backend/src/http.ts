const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

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

export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': JSON_CONTENT_TYPE
    }
  })
}

export function errorResponse(
  status: number,
  error: string,
  extras: Record<string, unknown> = {}
): Response {
  return jsonResponse(
    {
      error,
      ...extras
    },
    status
  )
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status })
}

export function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      location
    }
  })
}
