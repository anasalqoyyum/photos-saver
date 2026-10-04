# Google OAuth Setup for Chrome and Firefox

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

## 4c) Create OAuth client for Firefox

1. Open `APIs & Services` -> `Credentials` -> `Create credentials` -> `OAuth client ID`.
2. Application type: `Web application`.
3. Build and temporarily load the extension in Firefox using the steps in section 6.
4. In `about:debugging#/runtime/this-firefox`, click `Inspect` for this extension and run this in its console:
   ```js
   chrome.identity.getRedirectURL()
   ```
5. Copy the returned URL, including its trailing slash, into the client's Authorized redirect URIs. Firefox derives this URL from `browser_specific_settings.gecko.id`; keep that ID stable. See [Mozilla's redirect URL documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/getRedirectURL).
6. Copy this web client ID into `FIREFOX_WEB_OAUTH_CLIENT_ID` in `src/oauth-config.ts`, then rebuild and reload the extension.

## 5) Update manifest

Edit `manifest.json`:

- Replace `oauth2.client_id` with your generated client ID.
- (Optional but recommended) Replace `key` with your extension public key to keep a stable extension ID across reloads/machines.

Edit `src/oauth-config.ts`:

- Leave `WEB_OAUTH_CLIENT_ID` as placeholder to reuse `manifest.json` `oauth2.client_id` (recommended default).
- Only set `WEB_OAUTH_CLIENT_ID` if you specifically need a separate Web OAuth client.
- Set `FIREFOX_WEB_OAUTH_CLIENT_ID` when using Firefox.

If `key` is not set, Chrome can generate different IDs in different environments, which can break OAuth Item ID matching.

## 6) Build and load extension

1. Install dependencies:
   - `pnpm install`
2. Transpile TypeScript:
   - `pnpm build`
3. Open `chrome://extensions` for Chrome 121 or later, or `about:debugging#/runtime/this-firefox` for Firefox 121 or later.
4. In Chrome, click `Load unpacked` and select this repo root. In Firefox, click `Load Temporary Add-on` and select this repo's `manifest.json`.

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
- Firefox auth fails immediately:
  - Set `src/oauth-config.ts` `FIREFOX_WEB_OAUTH_CLIENT_ID` to a Web OAuth client.
  - Inspect the extension in `about:debugging#/runtime/this-firefox`, run `chrome.identity.getRedirectURL()`, and add the returned URL to that client's Authorized redirect URIs.
- `redirect_uri_mismatch` during PKCE fallback:
  - Run `chrome.identity.getRedirectURL()` in the extension's background console and add the exact returned URL to the Web OAuth client's Authorized redirect URIs.
  - Chrome returns `https://<your-extension-id>.chromiumapp.org/`; Firefox returns a URL derived from its Gecko extension ID.
  - Keep the extension ID stable and include the trailing slash when registering the URL.

If you switch to backend mode, use `docs/setup-backend-workers.md` for Workers backend OAuth setup.
