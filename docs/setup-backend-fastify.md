# Fastify Backend Setup (Cloudflare-oriented)

This guide configures the backend that handles Google OAuth and Google Photos upload calls.

## 1) Configure Google OAuth credentials

Create credentials in Google Cloud:

1. OAuth client type: **Web application** (for backend token exchange)
2. Authorized redirect URI:
   - `https://<your-backend-domain>/v1/auth/callback`

Also keep your extension OAuth client (Chrome Extension type) if you still use direct mode.

## 2) Configure backend environment

Set these for the backend runtime:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (must match Google OAuth config exactly)
- `TOKEN_ENCRYPTION_KEY` (base64/base64url 32-byte key)
- Optional: `GOOGLE_SCOPES`
- Optional: `CORS_ORIGIN`
- Optional: `ALLOWED_GOOGLE_USER_ID` (set this to your own Google `sub` user id for single-user lock)

For local Node development, create `backend/.env` (for example by copying `backend/.env.example`).

## 2b) Configure Cloudflare bindings

In `backend/wrangler.toml`, set real IDs for:

- `AUTH_KV` (KV namespace)
- `APP_DB` (D1 database)

Apply D1 migration from `backend/migrations/0001_google_tokens.sql`.

## 3) Configure extension backend mode

Edit `src/backend-config.ts`:

- set `BACKEND_MODE_ENABLED = true`
- set `BACKEND_BASE_URL` to your deployed backend base URL

## 4) Runtime notes

- In Cloudflare runtime with bindings configured, backend uses durable KV + D1 storage.
- Google refresh tokens are encrypted at rest using `TOKEN_ENCRYPTION_KEY`.
- In local Node dev (`backend/src/server.ts`), backend falls back to in-memory stores.
- If deploying to Cloudflare Workers, validate large payload behavior and timeout limits for image upload requests.
