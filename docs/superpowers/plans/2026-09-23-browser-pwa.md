# P10 Browser/PWA implementation plan

Base: `62e72660a8b52e1093e45baa86362d4b024da042` (`origin/main`).
Branch/worktree: `feat/phase10-browser-pwa`, `D:/codex/TG_OurMemoriesDevBot/worktrees/phase10-browser-pwa`.

## Scenario and invariants

A family member opens memoLy in Safari, Chrome, or an installed PWA. If this browser has no session, the user opens the existing MAX Mini App to confirm their MAX profile. The browser receives its own normal memoLy session, then can reopen without MAX until that session expires or is revoked. A lost session can be recovered through the same MAX profile. An invite can be retained across this exchange and accepted exactly once. Existing MAX Mini App startup, bot ingestion, role checks, direct MAX video upload, and backend-mediated playback keep their current semantics.

Do not add email/password, passkeys, new media storage, offline family-data caching, or new permissions. Do not change Memory, MediaAsset, Family, or FamilyMember contracts for this feature.

## 1. Browser pairing and session (backend)

Add a short-lived, one-use browser login challenge. The browser starts it under a trusted origin and receives a MAX `startapp` link. A browser-only, HttpOnly challenge cookie binds redemption to the initiating browser. The MAX Mini App shows the pairing code and explicitly approves after signed MAX launch data are verified and matched to the authenticated MAX principal. The original browser polls for approval, then atomically consumes the challenge and receives the existing memoLy access token and refresh-cookie. New sessions retain MAX `ExternalIdentity` provenance. A second redeem, expired challenge, mismatched MAX subject, missing browser cookie, or wrong origin fails closed.

Relevant paths: `backend/src/modules/auth/**`, `backend/prisma/schema.prisma`, migration, `packages/contracts/src/auth.ts`, `backend/src/app.ts`. The integrator owns schema, migration, contracts, and composition. Check schema validation and typechecks. The current task instruction does not authorize adding or running tests. Stop if a safe atomic consume and session issue cannot be achieved with existing repository transactions.

## 2. One React app in three host contexts (frontend)

Keep the existing MAX and Telegram host adapters and their automatic signed launch authentication. Add an ordinary browser state that restores the cookie session and otherwise starts the MAX pairing flow. Add a small MAX confirmation screen for a `browser_<challenge>` launch. A browser invite URL must survive authentication and use the existing preview/accept APIs. Repeated visits must return to the existing family. The browser can open MAX bot links with ordinary navigation. Preserve existing MAX invite links, current MAX video acceptance gate, and server role checks. Expose existing video composer only to authorized browser Owner/Full users, using the existing MAX upload implementation.

Relevant paths: `webapp/src/App.tsx`, `webapp/src/features/auth/**`, `webapp/src/platform/**`, `webapp/src/features/family/**`, `webapp/src/features/feed/**`. Check the production build and typecheck. Stop if an unauthenticated browser can reach family content or a Viewer gains video upload UI.

## 3. Installable PWA shell

Add manifest, same-origin start URL and scope, standalone display, theme metadata, and compliant branded WebP icons. The existing private-media service worker continues its media-access role; do not add a competing root-scope worker or cache private responses. Online-only functionality is acceptable for this phase. Verify the manifest and browser installation behavior; verify MAX SDK detection still selects MAX in the Mini App.

Relevant paths: `webapp/index.html`, `webapp/public/**`, `webapp/src/platform/media/**` only if needed. No lockfile or new dependency unless justified.

## Final gate

Run contract/backend/frontend typechecks, schema validation, build, and diff review. Record that real provider CORS and real Safari/Chrome codec behavior require device acceptance with MAX credentials; static checks do not prove them. Obtain independent review of the complete diff and address confirmed P0–P2 findings before reporting completion. No push, PR, merge, or deploy without a separate publication decision.
