# Repository Guidelines

## Project Structure & Module Organization
This workspace has two TypeScript apps managed with `pnpm`.

- `src/` contains the Chrome extension logic, with `src/sw.ts` as the MV3 service worker entrypoint.
- `tests/` holds root extension unit tests such as `filename.test.ts`.
- `backend/src/` contains the Cloudflare Worker backend built with Hono.
- `backend/tests/` holds backend unit tests.
- `backend/migrations/` stores D1 SQL migrations.
- `docs/` contains setup and architecture notes for OAuth and backend deployment.
- `manifest.json` defines the extension package; compiled root output goes to `dist/`.

## Build, Test, and Development Commands
Install dependencies once with `pnpm install`.

- `pnpm typecheck` checks the extension TypeScript without emitting files.
- `pnpm test` runs root tests with Node’s built-in test runner and `tsx`.
- `pnpm build` compiles the extension into `dist/`.
- `pnpm backend:typecheck` checks the Worker code.
- `pnpm backend:test` runs backend tests.
- `pnpm backend:dev` starts the local Wrangler runtime for backend-only development.

Prefer running type checks and relevant tests before opening a PR. Use the setup docs in [`docs/`](./docs) before testing OAuth flows locally.

## Coding Style & Naming Conventions
Use TypeScript ESM, strict compiler settings, and 2-space indentation. Keep imports relative with explicit `.js` or `.ts` extensions matching the existing code. Use:

- `camelCase` for variables and functions
- `PascalCase` for types and interfaces
- kebab-case for filenames such as `image-fetch.ts`

Follow the existing style: small focused modules, early returns, and clear log/error messages instead of dense abstractions.

## Testing Guidelines
Place tests beside each app in `tests/` or `backend/tests/`, and name them `*.test.ts`. This repo uses `node:test` with `assert/strict`; add focused unit tests for changed behavior rather than broad integration scaffolding. No coverage gate is configured, so contributors should add or update tests whenever auth, filename handling, HTTP helpers, or upload flows change.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits: `fix: ...`, `feat: ...`, `feat(scope): ...`, and `chore: ...`. Keep subjects short and imperative.

PRs should include a concise summary, linked issue or context, test evidence (`pnpm test`, `pnpm backend:test`, etc.), and screenshots or request/response samples when changing extension UX, auth flows, or backend endpoints. Update docs when setup, env vars, or deployment behavior changes.
