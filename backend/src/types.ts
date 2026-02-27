export interface AuthStateRecord {
  state: string
  extensionRedirectUri: string
  createdAt: number
  expiresAt: number
}

export interface ExchangeCodeRecord {
  code: string
  userId: string
  createdAt: number
  expiresAt: number
}

export interface SessionRecord {
  token: string
  userId: string
  createdAt: number
  expiresAt: number
}

export interface StoredGoogleTokens {
  userId: string
  refreshToken: string
  scope?: string
  updatedAt: number
}

export interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
  error?: string
  error_description?: string
}
