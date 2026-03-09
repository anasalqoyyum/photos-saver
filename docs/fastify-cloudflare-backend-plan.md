# Historical Plan: Fastify Backend on Cloudflare for Google Photos Uploads

This document is kept for context from the initial design phase. The current backend implementation is worker-native, Hono-based, and no longer uses Fastify.

## Goal

Move Google OAuth and upload orchestration to a backend so the extension works consistently on Chrome and ungoogled-chromium, while preserving original image quality and source URL caption.

## Why this helps

- Removes dependency on `chrome.identity.getAuthToken` browser behavior.
- OAuth happens on backend (standard Google web OAuth), so ungoogled browser quirks are reduced.
- Keeps extension thin: fetch image bytes in browser, upload bytes to backend.

## Architecture (recommended)

- **Extension (MV3 service worker)**
  - Captures right-click image URL.
  - Fetches original bytes locally (best chance to access site-authenticated images).
  - Calls backend APIs for auth session + upload.

- **Backend (Fastify + Cloudflare deployment target)**
  - Handles Google OAuth code exchange and refresh token lifecycle.
  - Stores encrypted per-user Google refresh tokens.
  - Uploads bytes to Google Photos (`/v1/uploads` + `mediaItems:batchCreate`).

- **Data stores**
  - Cloudflare D1: users, provider accounts, encrypted tokens, upload audit records.
  - Cloudflare KV: short-lived auth state and one-time session exchange codes.
  - Optional: Cloudflare R2 only if temporary blob buffering is needed (not required in v1).

## Important runtime note

Fastify is Node-oriented; Cloudflare Workers runtime is fetch/event oriented. Plan for one of these deployment shapes:

1. **Preferred with Fastify**: run Fastify in a Cloudflare-compatible Node environment (for example, Cloudflare Containers or another Node runtime behind Cloudflare).
2. **If strict Workers-only is required**: use a Workers adapter layer and validate compatibility early (spike task in Phase 1).

This plan keeps Fastify as the application framework either way.

## Auth flow (backend-centric)

1. Extension calls `POST /v1/auth/start`.
2. Backend returns `authUrl` and `state`.
3. Extension opens `authUrl` via `chrome.identity.launchWebAuthFlow`.
4. Google redirects to backend callback.
5. Backend exchanges code with Google (client secret stays server-side), stores encrypted refresh token.
6. Backend redirects to extension `chromiumapp.org` URL with one-time `session_code`.
7. Extension calls `POST /v1/auth/exchange` with `session_code` to receive backend session token (JWT or opaque token).

## Upload flow

1. User clicks `Save to Google Photos`.
2. Extension fetches source image bytes directly from page URL.
3. Extension posts multipart/binary payload to `POST /v1/photos/upload` with:
   - raw bytes
   - original/resolved filename
   - source URL
   - content type
4. Backend refreshes Google access token from stored refresh token.
5. Backend uploads bytes to Google Photos, then creates media item with:
   - `simpleMediaItem.fileName`
   - `description = sourceUrl`
6. Backend returns success/failure payload; extension shows notification.

## API contract (v1)

- `POST /v1/auth/start` -> `{ authUrl, state }`
- `GET /v1/auth/callback` -> redirect to extension with `session_code`
- `POST /v1/auth/exchange` -> `{ sessionToken, expiresAt }`
- `POST /v1/photos/upload` -> `{ mediaItemId, fileName, status }`
- `POST /v1/auth/logout` -> revoke backend session
- `GET /v1/health` -> health check

## Security model

- Encrypt refresh tokens at rest (KMS-managed secret; never plaintext).
- Use one-time auth exchange codes with short TTL (60-120s).
- Session token TTL short (for example 15m), refresh via backend-only rotation endpoint.
- CSRF/state validation on OAuth callback.
- Strict CORS allowlist for extension origin(s).
- Rate limits per user/session/IP on upload endpoints.
- Redact secrets/tokens from logs.

## Backend project structure

- `backend/src/app.ts` (Fastify bootstrap)
- `backend/src/routes/auth.ts`
- `backend/src/routes/photos.ts`
- `backend/src/services/google-oauth.ts`
- `backend/src/services/google-photos.ts`
- `backend/src/services/token-store.ts`
- `backend/src/plugins/security.ts`
- `backend/src/types.ts`
- `backend/wrangler.toml` (or platform config)
- `backend/migrations/*.sql` (D1 schema)

## Extension changes needed

- Replace direct Google token flow in `src/auth.ts` with backend session flow.
- Add backend API client module (`src/backend-api.ts`).
- Keep local image fetch logic (`src/image-fetch.ts`) to preserve quality.
- Update `src/sw.ts` to call backend upload endpoint.
- Add settings for backend base URL and auth status checks.

## Milestones

1. **Spike**: validate Fastify runtime shape on chosen Cloudflare deployment target.
2. **Backend skeleton**: health route, config, logging, error handling.
3. **OAuth backend flow**: start/callback/exchange/session issuance.
4. **Token storage**: encrypted refresh token persistence.
5. **Upload API**: Google Photos upload/create integration.
6. **Extension migration**: backend auth + upload integration.
7. **Hardening**: rate limit, CORS, structured logs, retries.
8. **Docs**: setup, env vars, OAuth credentials, operational runbook.

## Verification plan

- Manual:
  - Chrome and ungoogled: authenticate, upload a public image, verify in Photos.
  - Verify filename preserved and description includes source URL.
  - Upload failure path shows user-visible error.
- Integration tests:
  - OAuth callback state validation.
  - Session code one-time use and expiry.
  - Upload endpoint with mocked Google APIs.
- Security checks:
  - No token leakage in logs.
  - Invalid/expired session rejected.
  - Rate limit and CORS behavior enforced.

## Rollout strategy

- Add backend mode behind feature flag in extension.
- Keep current direct-upload flow temporarily as fallback.
- Enable backend mode by default after successful browser matrix testing.
