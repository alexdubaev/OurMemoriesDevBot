# Repository map

| Required concern | Existing Vibe location | Block 00 decision |
| --- | --- | --- |
| Backend runtime | `backend/` | Keep as the Hono/Prisma backend boundary; Telegram adapter is not implemented yet. |
| Web Mini App | `webapp/` | Keep React/Vite primitives; replace active template product navigation with an honest connection screen in this block. |
| Shared contracts | `packages/contracts/` | Preserve as the future public-contract boundary. No Memories or Telegram contract is added yet. |
| Local PostgreSQL | `docker-compose.yml`, `backend/.env.example` | Keep Docker Compose and synthetic local data only. |
| Architecture guard | `scripts/architecture-check.mjs` | Reuse unchanged. |
| Documentation package | `docs/mvp/`, `assets/`, `references/`, `templates/` | Copied from the approved package; `archive/` is intentionally excluded. |
| Changed-path verification | `scripts/verify-plan.mjs`, `verification-map.json` | Added by Block 00; plans commands only and fails closed for unknown paths. |

Template identifiers such as `@web-app-demo/*` and `web_app_demo` remain internal Vibe implementation names in this block. Renaming them requires coordinated changes across workspace manifests, generated Prisma paths, Compose, test fixtures, and `bun.lock`; it is not required to establish MVP boundaries and is deferred rather than silently regenerated.
