# MEMOLY-F12-MAX-SESSION-REPLACEMENT

Status: REVIEW. Lead: GPT-6 Codex. Implementation and one bounded review-fix pass complete; publication/physical acceptance tracked in the final report.

Base/fresh main: `e383d79269a3595f4c6cabedf167335aea042cf3`.
Branch: `fix/max-browser-session-replacement`.
Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/max-browser-session-replacement`.

## Accepted boundary

The owner approved replacing only the browser session proven by its refresh credential after successful MAX or MAX-approved browser-link authentication, including fresh authentication by the same account. Independent devices remain active. Invalid/failed login must not revoke the predecessor. No schema, token format, cookie policy, ACL, media/UI, other-adapter or production changes. PR #176 and its worktree remain untouched.

## Source ruling

MAX exchange already receives the refresh cookie but uses it only for replay matching, resolving it before its issuing transaction. Browser-link redemption receives only its verifier and cannot identify the browser predecessor. The refresh-family locator is server-authenticated, but a locator alone is not sufficient current-credential proof. Replacement must recheck current or immediately previous in-grace credential against the exact session inside the issuing transaction, and atomically create the successor/replay or redeemed challenge and revoke only the predecessor. Recognized stale/revoked credentials must not silently issue another unlinked successor in a competing replacement. Failed/replayed authentication must not mutate the predecessor or emit a replacement cookie. Preserve existing refresh CAS and stale-response/epoch protections; HTTP response delivery order cannot be made atomic by a DB transaction.

Compatibility ruling after a targeted regression: a still-present exact current credential may identify an unrevoked but expired/absolute-expired predecessor for retirement during independently verified fresh MAX/browser-link authentication. It never restores that predecessor or authorizes its JWT; same-payload replay can reuse only a live, non-absolute-expired session. Recognized revoked credentials and nonmatching/out-of-grace credentials remain rejected. This avoids trapping normal reauthentication behind an expired cookie without weakening credential proof or revoking other devices.

## Owned test infrastructure

New container: `memoly-f12-pg18-20261017-a91f`; label `memoly.task=MEMOLY-F12-MAX-SESSION-REPLACEMENT`; PostgreSQL 18 bound only to `127.0.0.1:56570`.
New DB: `memoly_f12_sessions_20261017_a91f_test`; DB/current user verified as `memoly_f12`; all 48 existing migrations deployed. Every DB command sets explicit TEST_DATABASE_URL and DATABASE_URL. No inherited URL or old audit DB is used. Synthetic filesystem roots/logs remain in unique ignored task directories and are retained.

## Bounded implementation and acceptance

1. Add a new MAX-only PostgreSQL/API regression file, independent of mixed historical suites. Reproduce F12 with real own-fixture upload/finalize/publication and media-cookie; save a red log before production edits.
2. Implement minimal session replacement in auth MAX service, browser-link service/route, internal ports/repository and auth-module dependency wiring if needed. Allowed production paths: `backend/src/modules/auth/application/{max-auth-service.ts,browser-link-service.ts,ports.ts}`, `infrastructure/auth-repository.ts`, `transport/routes.ts`, `index.ts`. Changes to generic refresh/logout need a concrete reproduced reason and lead ruling. Do not edit other adapter functions within shared files.
3. Exercise A–G on real disposable PG: old bearer/media denial immediately and after B logout; independent device; failed MAX/challenge validation; same-user fresh auth and same-payload replay; browser-link predecessor vs approver isolation; refresh/grace/logout; duplicate and intersecting replacements/refresh/logout. Preserve synthetic fixtures and record actual outcomes without token/cookie/file contents.
4. Lead inspects diff and personally verifies relevant MAX/API tests, backend typecheck, architecture and diff checks. One fresh independent read-only review, one bounded fix pass/narrow closure if necessary. No repeated review loops.
5. Publish only this task branch and a separate draft PR with report, red/green evidence, rollback, remaining physical acceptance and interaction with #176. No merge/deploy. `verify:local` before any later merge remains required; its historical-platform scope conflict must be documented, not bypassed.

## Stop conditions

Wrong origin; uncertain DB ownership; foreign dirty work; inability to prove predecessor; schema/token/cookie-policy or wider auth architecture requirement; change to independent-device behavior; non-fast-forward push. Escalate concrete blockers rather than silently expanding scope.
