# Photos Saver Backend (Cloudflare Worker + Hono)

Worker-native Hono backend for OAuth and Google Photos uploads.

## Environment variables

- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_OAUTH_REDIRECT_URI` - callback URL (`https://<backend-host>/v1/auth/callback`)
- `TOKEN_ENCRYPTION_KEY` - base64/base64url 32-byte key for refresh-token encryption at rest
- `GOOGLE_SCOPES` (optional)
- `GOOGLE_OAUTH_FORCE_CONSENT` (optional; defaults to `false`)
- `CORS_ORIGIN` (optional; defaults to `chrome-extension://<id>` and localhost origins)
- `ALLOWED_GOOGLE_USER_ID` (optional, recommended for single-user mode)
- `SESSION_TTL_MS` (optional; defaults to `900000` / 15 minutes)
- `AUTH_STATE_TTL_MS` (optional; defaults to `300000` / 5 minutes)
- `EXCHANGE_CODE_TTL_MS` (optional; defaults to `120000` / 2 minutes)
- `MAX_UPLOAD_BYTES` (optional)

Recommended personal-use values:

```env
SESSION_TTL_MS=2592000000 / 30 days
AUTH_STATE_TTL_MS=600000 / 10 minutes
EXCHANGE_CODE_TTL_MS=300000 / 5 minutes
```

## Routes

- `GET /health`
- `GET /v1/health`
- `POST /v1/auth/start`
- `GET /v1/auth/callback`
- `POST /v1/auth/exchange`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `POST /v1/photos/upload`

## Session renewal

The extension renews an unexpired backend session when seven days or less remain.
`POST /v1/auth/refresh` issues a new token with the configured `SESSION_TTL_MS`.
The previous token remains valid until its original expiry, so a lost refresh
response or failed storage write does not invalidate the client's saved token.
Retries can create additional sessions. Renewal does not extend the old token's
lifetime, and logout revokes only the token supplied to that request.

The extension saves the replacement before using it. Storage failures stop the
upload and report an error; another attempt can retry renewal with the saved
token. If that token expires before recovery, Google sign-in is still required.
Concurrent uploads share session resolution, and a delayed rejection of an old
token cannot clear a newer session.

KV reads can be stale. Missing or expired session reads return no session without
deleting the key; KV expiration and explicit logout handle removal. A transient
KV miss can still reject authentication, but it no longer deletes a valid record.

Deploy the Worker with `pnpm backend:deploy`, then rebuild the extension with
`pnpm build` and reload it in `chrome://extensions`. Deploy the Worker first so
the extension can recover from refresh failures without losing the saved token.
The GitHub Actions workflow only runs checks. Worker deployment runs separately,
either through Cloudflare's Git integration or a manual deploy. Confirm the
production version before reloading Chrome; a successful branch build does not
by itself identify the version serving production. Chrome still requires a
rebuilt and reloaded extension. No database migration is needed for these changes.

## Local development

1. Install deps:

   ```bash
   pnpm --filter photos-saver-backend install
   ```

2. Copy `backend/.dev.vars.example` to `backend/.dev.vars`, then fill secrets:

   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8787/v1/auth/callback
   TOKEN_ENCRYPTION_KEY=...
   ```

3. Start local worker runtime:

   ```bash
   pnpm --filter photos-saver-backend dev
   ```

## Cloudflare bindings

Configure bindings in `backend/wrangler.toml`:

- KV binding `AUTH_KV` for session tokens.
- D1 binding `APP_DB` for encrypted Google refresh-token records and one-time auth artifacts.
- The repo root includes `.wrangler/deploy/config.json` so Cloudflare deploys run from the monorepo root still load this backend config.

Apply migrations:

```bash
wrangler d1 migrations apply photos-saver-backend --local
wrangler d1 migrations apply photos-saver-backend --remote
```

Build the Worker bundle (dry run):

```bash
pnpm backend:build
```

Deploy:

```bash
pnpm backend:deploy
```

Generate encryption key (example):

```bash
openssl rand -base64 32
```
