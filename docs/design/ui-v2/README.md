# memoLy UI v2 Lab

Task: MEMOLY-UI-V2-REACT-LAB. Dedicated branch `design/ui-v2-react-lab`.
This is an interactive presentation prototype for owner review, isolated from the production app.

From the task worktree:

```powershell
bun install --frozen-lockfile
cd webapp
bun run dev -- --config ui-v2.vite.config.ts
```

Open [catalog](http://127.0.0.1:4197/__fixtures/ui-v2).
Select SCREEN, STATE, ROLE, THEME, VIEWPORT. All 248 states have OPEN buttons in twelve groups.
The narrow preview has its own scroll surface; catalog scrolling does not scroll the app.
The catalog's “Чистый preview” link opens the selected state without tooling.
Example: [clean photo Feed](http://127.0.0.1:4197/__fixtures/ui-v2?entry=feed:photo&role=owner&theme=mint&width=390&preview=1).
In clean mode the browser width is the actual viewport, capped at 560px on a wide browser.

No backend, .env, credentials, host SDK, QueryClient or production bootstrap is needed.
The separate dev server rejects API/storage paths and has no proxy.
Normal production entry, routing, configuration and public assets remain unchanged.
Run this config explicitly; the ordinary production/dev app never imports Lab.

Fixtures contain fictional Russian family names and three synthetic local photographs.
Memory edits, reactions, profile changes and deletion live in React state and reset on reload.
Playback, copy/share, installation, login and provider readiness simulate UI outcomes.
No sound recording, actual playback engine, clipboard mutation, sharing, host login or real invites.

Targeted verification:

```powershell
# from worktree root
bun run --cwd webapp typecheck
bun run --cwd webapp lint
bun run --cwd webapp build
bun run architecture:check
bun run template:check
# build first: browser test also inspects production dist
cd webapp
bunx playwright test --config e2e/ui-v2/playwright.config.ts
```

See [SCREEN_MATRIX](SCREEN_MATRIX.md), [OWNER_REVIEW](OWNER_REVIEW.md) and [VERIFICATION](VERIFICATION.md).
Independent findings and resolutions: [REVIEW](REVIEW.md).
No integration, merge or deployment is part of this task.
