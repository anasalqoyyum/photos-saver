# Google OAuth Setup for Chrome Extension

This extension uses the Google Photos Library API with the OAuth scope:

- `https://www.googleapis.com/auth/photoslibrary.appendonly`

## 1) Create a Google Cloud project

1. Open Google Cloud Console.
2. Create a new project (or pick an existing one).
3. Ensure billing and organization policies allow OAuth app setup.

## 2) Enable Google Photos Library API

1. Open `APIs & Services` -> `Library`.
2. Search for `Google Photos Library API`.
3. Click `Enable`.

## 3) Configure OAuth consent screen

1. Open `APIs & Services` -> `OAuth consent screen`.
2. Select `External` for personal/public usage (or `Internal` for Workspace-only usage).
3. Fill required app details (app name, support email, developer contact).
4. Add scope:
   - `https://www.googleapis.com/auth/photoslibrary.appendonly`
5. If app is in Testing mode, add your Google account under `Test users`.

## 4) Create OAuth client for Chrome Extension

1. Open `APIs & Services` -> `Credentials` -> `Create credentials` -> `OAuth client ID`.
2. Application type: `Chrome Extension`.
3. Enter your extension ID.

How to get extension ID:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension folder once.
4. Copy the generated extension ID.

Note: The extension ID must match the ID used in OAuth credentials.

## 4b) Create OAuth client for Web Auth PKCE fallback (recommended for ungoogled-chromium)

1. Open `APIs & Services` -> `Credentials` -> `Create credentials` -> `OAuth client ID`.
2. Application type: `Web application`.
3. Add Authorized redirect URI:
   - `https://<your-extension-id>.chromiumapp.org/`
4. Copy this web client ID.

## 5) Update manifest

Edit `manifest.json`:

- Replace `oauth2.client_id` with your generated client ID.
- (Optional but recommended) Replace `key` with your extension public key to keep a stable extension ID across reloads/machines.

Edit `src/oauth-config.ts`:

- Leave `WEB_OAUTH_CLIENT_ID` as placeholder to reuse `manifest.json` `oauth2.client_id` (recommended default).
- Only set `WEB_OAUTH_CLIENT_ID` if you specifically need a separate Web OAuth client.

If `key` is not set, Chrome can generate different IDs in different environments, which can break OAuth Item ID matching.

## 6) Build and load extension

1. Install dependencies:
   - `pnpm install`
2. Transpile TypeScript:
   - `pnpm build`
3. Open `chrome://extensions`.
4. Click `Load unpacked` and select this repo root.

## 7) Verify auth flow

1. Open any page with an image.
2. Right-click image -> `Save to Google Photos`.
3. First run should prompt OAuth consent.
4. On success, extension shows a success notification.

## Troubleshooting

- `invalid_client`:
  - OAuth client ID is wrong, deleted, or not for Chrome Extension type.
- `access_denied`:
  - User canceled consent or is not listed as a test user while app is in Testing mode.
- `OAuth token was rejected`:
  - Token expired/revoked; trigger action again to re-authenticate.
- API enabled but still failing:
  - Verify the same project owns both OAuth credentials and enabled Photos API.
- ungoogled-chromium does not show Google consent with `getAuthToken`:
  - This extension automatically falls back to OAuth PKCE web flow (`launchWebAuthFlow`).
  - Ensure `manifest.json` has host permissions for `https://accounts.google.com/*` and `https://oauth2.googleapis.com/*`.
  - If using a separate web client, set it in `src/oauth-config.ts` `WEB_OAUTH_CLIENT_ID`.
- `redirect_uri_mismatch` during PKCE fallback:
  - The redirect URI must be exactly `https://<your-extension-id>.chromiumapp.org/`.
  - In the Web OAuth client, add that exact URI under Authorized redirect URIs.
  - Ensure `<your-extension-id>` matches the runtime ID shown in service worker logs.

If you switch to backend mode, use `docs/setup-backend-fastify.md` for backend OAuth setup.
