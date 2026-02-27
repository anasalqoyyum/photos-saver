# Photos Saver Backend (Fastify)

Fastify backend for OAuth and Google Photos uploads.

## Environment variables

- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_OAUTH_REDIRECT_URI` - backend callback URL (`https://<backend-host>/v1/auth/callback`)
- `GOOGLE_SCOPES` (optional)
- `CORS_ORIGIN` (optional, default `*`)
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
pnpm --filter photos-saver-backend dev
```

## Cloudflare

This repo includes `wrangler.toml` and a Workers `fetch` adapter (`src/worker.ts`) that routes requests into Fastify via `inject`.

Before deploying, verify runtime behavior for your target plan and payload sizes.
