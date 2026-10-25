# Member avatar synchronization implementation plan

> For agentic workers: use the delegated development workflow; apply test-driven-development. The lead owns architecture, integration and release.

**Task:** MEMOLY-MEMBER-AVATAR-SYNC
**Goal:** An uploaded, replaced, cropped or removed user avatar appears consistently for other family participants in Family, feed and comments without image retry/render storms.
**Base:** ecabbbdf6eb8eb0ac19ae00a937893dcd0f7d049
**Branch/worktree:** fix/member-avatar-sync; D:/codex/TG_OurMemoriesDevBot/worktrees/member-avatar-sync
**Spec:** Owner report and confirmation: only avatar display is broken; preserve previous avatar error protections. Existing authoritative backend ready UserAvatar and family ACL remain unchanged.
**Stack:** React 19, TanStack Query 5, Hono/Prisma, Bun, Playwright.

## Architecture and constraints

Use one selected-family avatar-directory provider above all selected family surfaces. Its source is the existing authenticated members endpoint, seeded by the freshly loaded member DTOs. Directory keys include authenticated account, family and membership epoch; directory responses are never persisted. Refresh at most once per 15 seconds while visible/online; stale focus/reconnect refresh may occur after 5 seconds. No per-image or per-comment polling, no background polling, no automatic query retries. Server/network errors back off to at most once per minute; terminal 401/403/404 stop periodic refresh and existing access-loss handling applies. Abort obsolete requests on scope disposal; remove directory cache on family revocation/session cleanup. A local avatar mutation invalidates its selected directory after existing successful mutation handling.

Directory values contain user ID, nullable immutable private avatar path and crop. Avatar renderers resolve by author user ID. A directory entry with null path is authoritative removal. Missing/departed users do not reuse a formerly ready directory avatar. Outside a matching provider, existing DTO rendering remains supported. Channel publication identity must continue to bypass user avatar resolution. Resolve paths before shared-loader deduplication as well as at image render, so comments/feed use the same current version and crop. Reuse the existing private image resource pool unchanged, retaining failure latches, request deduplication, bounded resources, revocation behavior and bound native timers (329ea607).

No backend production changes, schema/migrations, new endpoints/dependencies, user data changes, designs, SVGs or messenger changes. FULL applies because authenticated private avatar freshness/cache lifecycle changes. Only synthetic fixtures in tests. No server operations by workers.

## Review focus

- Local mutation versus in-flight directory read: cancellation and refetch must not restore old avatar metadata.
- Identity/family/epoch change, late responses and revoked access: private avatars must never cross scopes.
- Directory failures or invalid image bytes: no request/render loop; navigation stays usable.
- User has no avatar or removes it: stale comment/feed DTO must not resurrect old image.
- Channel authors, departed users and provider-free harnesses retain intended identity/fallback.

## Task 1: Reproduce and implement the bounded directory

Files: new webapp/src/features/avatar/member-avatar-directory.tsx; avatar/index.ts, member-avatar-query.ts; App.tsx; platform/persistence/private-cache.ts; focused tests under webapp/tests or existing avatar E2E harness.

- [ ] Add a failing behavioral browser regression with two independent authenticated sessions: viewer remains open with no author image, author uploads a synthetic avatar via the real API, viewer Family/comment surfaces update without reload. Record RED assertion before implementation.
- [ ] Add replacement, crop and removal coverage within the same short journey. Use existing max-family-audit server/config and synthetic upload helpers; avoid a new test infrastructure.
- [ ] Implement the provider and query policy specified above; accept familyId, accountId, membershipEpoch, seed members and authenticated transport. Expose a user-ID resolver hook and shared-author resolution support. Consume abort signals, disable background/error retries, deduplicate focus bursts and remove private cache on access loss.
- [ ] Wrap selected surfaces in App after confirmed membership; ensure portals inherit context and seed changes/local mutations update authoritative directory without stale responses.
- [ ] Run the same regression and record GREEN.

## Task 2: Wire avatar consumers and protect failure boundaries

Files: avatar/member-avatar.tsx; feed/shared-author-avatars.tsx; feed/FeedPage.tsx; memoly-ui/MemoryCardPresentation.tsx (confirm actual path); memoly-ui/FamilyPresentation.tsx; comments/CommentItem.tsx; existing avatar E2E harness/test; .autopilot/PROGRESS.md.

- [ ] Pass author user IDs through Family, feed cards, media viewer and comments. Shared loaders resolve current paths before deduplication. Preserve channel identity and provider-free fallback.
- [ ] Prove HTTP/image failure stays bounded across rerenders/focus and navigation; prove scope changes and aborted late responses do not reveal previous identity resources. Reuse pool tests and shared-author-avatar scenario instead of duplicating them.
- [ ] Record the fix under progress "Правки без автопилота" without claiming release completion.
- [ ] Run bun test webapp/tests/avatar-resource-pool.test.ts and relevant new boundary tests; bun run typecheck:webapp; targeted browser config including independent-session journey and shared-author-avatar.

## Integration and release (lead only)

- [ ] Inspect actual diff and evidence; run documented exact-SHA `bun run verify:local --profile full` against a dedicated *_test PostgreSQL environment.
- [ ] One fresh scoped independent Luna High review, bounded confirmed fix pass, narrow closure check.
- [ ] Fetch current main, merge if changed; recheck affected risks. Publish verified source/evidence in one PR, attach, squash merge and verify main.
- [ ] Read current Selectel runbook; deploy only after separately active video recovery finishes and host guards permit, using final release FULL, immutable artifacts, lock, disk/recovery/readiness guards. Do not interfere with the other release.
- [ ] Verify live release, clean only owned task artifacts, provide copyable HANDOFF.
