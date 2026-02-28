# Photos Saver Backend (Fastify)

Fastify backend for OAuth and Google Photos uploads.

## Environment variables

- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_OAUTH_REDIRECT_URI` - backend callback URL (`https://<backend-host>/v1/auth/callback`)
- `TOKEN_ENCRYPTION_KEY` - base64/base64url 32-byte key for refresh-token encryption at rest
- `GOOGLE_SCOPES` (optional)
- `CORS_ORIGIN` (optional; defaults to `chrome-extension://<id>` and localhost origins)
- `ALLOWED_GOOGLE_USER_ID` (optional, recommended for single-user mode)
- `SESSION_TTL_MS` (optional)
- `AUTH_STATE_TTL_MS` (optional)
- `EXCHANGE_CODE_TTL_MS` (optional)
- `MAX_UPLOAD_BYTES` (optional)

## Routes

- `GET /v1/health`
- `POST /v1/auth/start`
- `GET /v1/auth/callback`
- `POST /v1/auth/exchange`
- `POST /v1/auth/logout`
- `POST /v1/photos/upload`

## Local development

```bash
pnpm --filter photos-saver-backend install
cp backend/.env.example backend/.env
pnpm --filter photos-saver-backend dev
```

`src/server.ts` loads `backend/.env` automatically for local Node development.

## Cloudflare

This repo includes `wrangler.toml` and a Workers `fetch` adapter (`src/worker.ts`) that routes requests into Fastify via `inject`.

### Durable storage bindings

- KV binding `AUTH_KV` for session tokens.
- D1 binding `APP_DB` for encrypted Google refresh-token records and one-time auth artifacts.

Apply migrations:

```bash
wrangler d1 migrations apply photos-saver-backend --local
wrangler d1 migrations apply photos-saver-backend --remote
```

Build the Cloudflare Worker bundle (dry run):

```bash
pnpm backend:build
```

Deploy to Cloudflare Workers:

```bash
pnpm backend:deploy
```

Generate encryption key (example):

```bash
openssl rand -base64 32
```

Before deploying, verify runtime behavior for your target plan and payload sizes.
