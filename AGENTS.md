# Repository Guidelines

## Project Structure & Module Organization

- `web/` is the Vue 3/Vite frontend: pages in `web/src/views/`, reusable UI in `web/src/components/`, utilities in `web/src/utils/`, and static files in `web/public/`.
- `worker/` is the Hono-based Cloudflare Worker API: routes in `worker/src/routes/`, shared auth/security code in `worker/src/`, ordered D1 SQL in `worker/migrations/`, and tests in `worker/test/`.
- `scripts/` contains import helpers; `img/`, `resource/`, and `docs/` hold assets and design notes.

## Build, Test, and Development Commands

Run commands from the package directory they target:

```bash
cd web && npm ci && npm run dev       # local Vite frontend
cd web && npm run build               # production bundle in web/dist
cd worker && npm ci && npm run dev    # local Wrangler Worker
cd worker && npm test                 # Vitest + Miniflare/D1/R2 tests
cd worker && npm run migrate:local    # apply migrations to local D1
cd worker && npm run deploy           # deploy the Worker (authenticated Wrangler)
```

Use `npm run migrate:apply` only for intentional remote D1 changes. Python upload scripts document dry-run and production usage in `scripts/README.md`.

## Coding Style & Naming Conventions

Use two-space indentation and preserve the existing semicolon/style conventions. Vue components and views use PascalCase (for example, `MiniPlayer.vue`); JavaScript/TypeScript modules use lowercase or descriptive camel-case names, and Worker route modules use camelCase filenames. Keep route registration in `worker/src/routes/` and reuse shared auth/storage logic. No repository-wide formatter or linter is configured.

## Testing Guidelines

Add or update a focused `worker/test/<feature>.test.ts` test for each Worker endpoint or behavior change. Tests run serially against shared Worker storage, so clean up or restore mutated data. Run `cd worker && npm test` before submitting.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style prefixes such as `feat:`, `fix:`, `refactor:`, and `docs:`, with a concise scope when useful (for example, `feat(admin): ...`). Keep commits focused and imperative. Pull requests should describe user-visible/API or schema changes, list verification commands, call out migrations or deployment steps, include frontend screenshots when relevant, and link related issues or design notes.

## Security & Configuration

Never commit credentials, tokens, `ADMIN_PASSWORD`, or `JWT_SECRET`. Use `web/.dev.vars`/Wrangler local bindings and configure production secrets through Cloudflare. Verify the target before remote migrations, R2 uploads, or deployments.
