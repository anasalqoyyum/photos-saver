# Save to Google Photos (Chrome Extension)

Chrome extension that adds a right-click menu item on images:

- `Save to Google Photos`

When clicked, it uploads the original image bytes to Google Photos with:

- filename preserved when possible
- source image URL stored in Google Photos item description

## Features

- Right-click image -> save to Google Photos.
- Google OAuth authentication via `chrome.identity`.
- No resizing or re-encoding (uploads exact fetched bytes).
- Duplicates are allowed by design.
- Upload destination is main library (no album routing).

## Project structure

- `manifest.json` - MV3 extension manifest.
- `src/sw.ts` - service worker entrypoint.
- `src/auth.ts` - OAuth token handling.
- `src/image-fetch.ts` - source image download logic.
- `src/photos-api.ts` - Google Photos API integration.
- `src/filename.ts` - filename + description helpers.
- `src/errors.ts` - error normalization and user messages.
- `src/notify.ts` - success/failure notifications.
- `src/backend-api.ts` - backend auth + upload client.
- `src/backend-config.ts` - backend mode toggle and base URL.
- `backend/` - Cloudflare Workers backend (Hono).
- `docs/setup-google-oauth.md` - OAuth and Google Cloud setup.
- `docs/setup-backend-workers.md` - backend mode setup.

## Setup

1. Follow OAuth setup in `docs/setup-google-oauth.md`.
2. Install deps:
   - `pnpm install`
3. Build TypeScript to `dist/`:
   - `pnpm build`
4. Load unpacked extension in `chrome://extensions`.

## Backend mode (optional)

1. Follow `docs/setup-backend-workers.md`.
2. Set `src/backend-config.ts` `BACKEND_MODE_ENABLED = true`.
3. Set `src/backend-config.ts` `BACKEND_BASE_URL`.
4. Rebuild extension and reload.

## Commands

- `pnpm build` - transpile TS to `dist/`.
- `pnpm typecheck` - run TypeScript checks.
- `pnpm test` - run unit tests.

## Notes and limitations

- Some websites block direct image fetching (auth/cookies/CORS/hotlink rules). In these cases upload fails and extension shows an error notification.
- For `blob:` or `data:` image sources, extension intentionally fails fast.
- Google Photos API docs recommend user-meaningful descriptions; this project intentionally writes the source URL to description to satisfy product requirements.
- Keep extension ID stable for OAuth by setting `manifest.json` `key` to your extension public key.

## Browser compatibility

- Chrome: uses `chrome.identity.getAuthToken` first.
- ungoogled-chromium: if `getAuthToken` fails or times out, extension falls back to OAuth PKCE via `chrome.identity.launchWebAuthFlow`.
- PKCE fallback reuses `manifest.json` `oauth2.client_id` by default; optional override is available in `src/oauth-config.ts`.
- Backend mode avoids browser-specific OAuth implementation differences by delegating auth and Google API calls to Worker backend endpoints.

## Future enhancement

- Add Rolldown bundling as optional phase 2 if output/file layout optimization is needed.
