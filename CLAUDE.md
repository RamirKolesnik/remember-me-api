# remember-me-api

Backend of remember.me. The product brief lives in the claude.ai project "remember.me" (`claude/brief.md`).

- Node 22+ runs `.ts` files directly: only erasable TypeScript (no enums, namespaces, parameter properties), `import type` for types, `.ts` extensions in relative imports.
- `src/domain/wall.ts` must stay identical to `app/shared/wall.ts` in `remember-me-web`; change both together with tests.
- The server is the source of truth for prices. Never trust a price or zone sent by a client.
- Anything that must be atomic (holds, activation, expiry) lives in SQL functions in `db/migrations`. Never edit an applied migration: add a new numbered file.
- Tests: `TEST_DATABASE_URL=... npm test`; DB tests are skipped without it.
