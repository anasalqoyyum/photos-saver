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
- `SESSION_TTL_MS` (optional)
- `AUTH_STATE_TTL_MS` (optional)
- `EXCHANGE_CODE_TTL_MS` (optional)
- `MAX_UPLOAD_BYTES` (optional)

## Routes

- `GET /health`
- `GET /v1/health`
- `POST /v1/auth/start`
- `GET /v1/auth/callback`
- `POST /v1/auth/exchange`
- `POST /v1/auth/logout`
- `POST /v1/photos/upload`

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
