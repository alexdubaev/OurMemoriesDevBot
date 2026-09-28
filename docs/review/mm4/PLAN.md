# MM-4 integration plan

Base: `e6d027425f03f06c6e539ccb2302bc637b5cce75` (`origin/main`, 2026-09-28). Branch: `feat/mm-4-integration`. Worktree: `D:/codex/TG_OurMemoriesDevBot/worktrees/mm-4-integration`.

## Goal and boundaries

Prove one ordered mixed Memory crosses Web or MAX publication, real Feed API serialization, carousel/viewer, and Memory-level seen semantics. Reconcile legacy and migration behavior. Do not add product features or touch production.

Allowed change paths: `webapp/e2e/**`, `webapp/tests/**`, `backend/src/modules/{max,memories}/**/*.test.ts`, `backend/scripts/*upgrade.integration.test.ts`, and `docs/review/mm4/**`. Production code is allowed only for a demonstrated bounded defect, with a separate ruling. Forbidden: production deploy, historical import, unrelated source, lockfiles, generated code, and existing migration rewrites.

## Work units

1. **Web publication to Feed/browser.** Extend `webapp/e2e/specs/mm1-mixed-composer.spec.ts` to assert the created 4-attachment Memory's real Feed DTO and one carousel card, exact slide order, common caption/author/actions, nonzero video/photo viewer positions, and browser evidence. Verify with focused Playwright test. Preserve independent upload completion ordering in the existing composer unit test.
2. **MAX publication to Feed/API and seen.** Extend the four-attachment case in `backend/src/modules/max/capture.integration.test.ts` to read the published source via the real family Feed endpoint, assert one DTO with ordered attachment kinds and stable source/family/child identity after duplicate delivery, and verify one Memory-level unread/seen unit. Cover `occurredAt` edit with `sourcePublishedAt`, `firstPublishedAt`, and ordinal immutability. Verify with focused backend integration test. Do not alter race/idempotency architecture without lead ruling.
3. **Populated schema upgrade.** Add an isolated DB upgrade test under `backend/scripts/` that installs the pre-MM migrations, inserts legacy published rows, deploys MM-0/MM-2, proves nullable historical `firstPublishedAt`, legacy kind validity, new `media` and MAX video enum use, and DB first-publication guard. Verify with focused backend integration test. Do not edit applied migrations without a proven defect.
4. **Themes and visual regression.** Extend a mixed Feed browser case to switch all six themes through Settings, reload each or a representative persisted selection, inspect the mixed card at 320/390/430 widths, capture proportional synthetic screenshots and accessibility/focus evidence. Verify with focused Playwright test.
5. **Final gate.** Run relevant backend, web, contract, typecheck, build, E2E, and upgrade checks; inspect exact diff and generated artifacts; obtain one fresh Luna High review at a time; fix confirmed findings; fetch and merge fresh `origin/main` if changed; rerun affected checks; push, PR, await `verify-required` on final HEAD, and squash merge only if all acceptance gates pass.

## Stop conditions

Escalate only a new unresolved architecture, data-model, migration-semantics, security/ACL, production-data, complex idempotency/race, or locked-decision contradiction. If browser or isolated DB infrastructure fails, diagnose it and report actual evidence rather than claiming a green matrix.
