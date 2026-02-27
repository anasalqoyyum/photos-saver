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
- Optional: `GOOGLE_SCOPES`
- Optional: `CORS_ORIGIN`

## 3) Configure extension backend mode

Edit `src/backend-config.ts`:

- set `BACKEND_MODE_ENABLED = true`
- set `BACKEND_BASE_URL` to your deployed backend base URL

## 4) Runtime notes

- The backend currently uses in-memory stores for auth state, session tokens, and Google refresh tokens.
- In production, replace these with durable storage (for example D1/KV + encryption at rest).
- If deploying to Cloudflare Workers, validate large payload behavior and timeout limits for image upload requests.
