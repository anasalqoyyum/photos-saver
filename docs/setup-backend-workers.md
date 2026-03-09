# Cloudflare Workers Backend Setup

This guide configures the Hono-based Cloudflare Worker backend that handles Google OAuth and Google Photos uploads.

## 1) Configure Google OAuth credentials

Create credentials in Google Cloud:

1. OAuth client type: **Web application**
2. Authorized redirect URI:
   - `https://<your-backend-domain>/v1/auth/callback`

Keep your extension OAuth client (Chrome Extension type) if you still use direct mode.

## 2) Configure backend runtime variables

Set these variables for the Worker:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (must match Google OAuth config exactly)
- `TOKEN_ENCRYPTION_KEY` (base64/base64url 32-byte key)
- Optional: `GOOGLE_SCOPES`
- Optional: `CORS_ORIGIN`
- Optional: `ALLOWED_GOOGLE_USER_ID` (single-user lock)

For local development with Wrangler, copy `backend/.dev.vars.example` to `backend/.dev.vars` and set local values.

## 3) Configure Cloudflare bindings

In `backend/wrangler.toml`, set real IDs for:

- `AUTH_KV` (KV namespace)
- `APP_DB` (D1 database)

Apply D1 migrations from `backend/migrations/`:

```bash
wrangler d1 migrations apply photos-saver-backend --local
wrangler d1 migrations apply photos-saver-backend --remote
```

## 4) Run and deploy

Local dev:

```bash
pnpm backend:dev
```

Dry-run bundle build:

```bash
pnpm backend:build
```

Deploy:

```bash
pnpm backend:deploy
```

## 5) Configure extension backend mode

Edit `src/backend-config.ts`:

- set `BACKEND_MODE_ENABLED = true`
- set `BACKEND_BASE_URL` to your deployed Worker URL

## Runtime notes

- Backend uses KV for sessions and D1 for OAuth artifacts and encrypted refresh tokens.
- Refresh tokens are encrypted at rest using `TOKEN_ENCRYPTION_KEY`.
- Upload limits are controlled by `MAX_UPLOAD_BYTES`.
