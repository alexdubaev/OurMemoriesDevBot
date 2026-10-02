# memoLy UI v2 production migration — implementation plan

> For agentic workers: use teamlead-development with a fresh bounded worker per task.
> Follow superpowers:subagent-driven-development task execution; the lead owns integration and acceptance.

Goal: connect the owner's approved interface to the real application, preview the feature branch safely,
and retain a reliable path back to legacy presentation before considering main merge.

Architecture: keep existing live controllers and adapt presentation seams. A build-time legacy/v2 switch
gates new presentation; the six existing preference IDs select cover artwork only. Production hosting
remains on accepted main while a separate preview environment tests an immutable feature SHA.

Tech stack: current Bun / React / Vite frontend; unchanged Hono/Prisma/API/HostBridge/HTMLMediaElement.
Spec: [SPEC.md](SPEC.md).
Base: 329d6b9ccb7616adc6c5c75d2781db62400a5f32.
Branch/worktree: feat/ui-v2-production-migration / .worktrees/ui-v2-production-migration.

## Global constraints

- No backend/schema/API or user preference enum changes; no new dependencies.
- No Lab runtime/mock business actions/demo media in production.
- One worker writes at a time in this worktree; lead assigns explicit file ownership.
- No SVG/new icon library; new icons are optimized WebP RGBA at 48px/72px for 24px display.
- Illustration budget 100KB/file; icon budget 6KB/file; real originals are retained.
- UI mode default legacy; v2 uses one cream/sage palette irrespective of cover.
- Do not weaken main-only release rules, merge main, or deploy production in this assignment.
- Deterministic domain checks per block; independent review on the active block, confirmation of fixes,
  then fresh whole-change review. No style-only review loops.

## Review focus

1. Account/family switching cannot leave stale private image URLs or reactions: tasks 3/4/5 own regressions.
2. Viewer role never acquires mutations; same role gates in both presentations: tasks 2/5/6.
3. Slow/failed media, signed URL expiry and native playback remain real and recoverable: task 4.
4. Long names/ages, missing avatars and six covers remain readable at 320px/host insets: tasks 1/2.
5. Rollback mode and preview origin do not share private production storage or alter data: tasks 1/7/8.

## Task 1 — opt-in shared child header and raster assets

Worker ID: UIM-01. First implementation slice; old UI stays default.
Modify: webapp/src/components/ChildHeader.tsx.
Create: webapp/src/components/ui-v2/ChildHeaderV2.tsx, ChildHeaderV2.css, header-assets.ts.
Create: webapp/src/features/ui-version/ui-version.ts and public index.ts.
Create: webapp/public/assets/ui-v2/headers/*.webp, icons/settings-gear@2x.webp,
icons/settings-gear@3x.webp, manifest.json.
Tests: webapp/tests/ui-version.test.ts, ui-v2-header.test.tsx; preserve theme.test.tsx.

Interfaces: resolveUiVersion(value: string | undefined): 'legacy' | 'v2';
readUiVersion(): UiVersion reads VITE_MEMOLY_UI_VERSION only.
ChildHeader accepts optional uiVersion override for controlled presentation tests, default readUiVersion.
ChildHeaderV2 consumes the SAME existing ChildHeaderProps (child name/subtitle/real avatar/crop/theme,
mode and callbacks), without auth/network/storage behavior.
getUiV2HeaderAsset(theme: MemolyTheme) returns the local cover URL.
Mapping: mint→bunny, rose→kite, sky→airplane, lavender→whale, apricot→bear, sand→moon.

- [x] Run baseline theme/design-system/feed tests; record counts and exit.
- [x] Add meaningful tests: default/invalid UI mode is legacy, explicit v2 uses live name/avatar/crop,
  preserves callback-accessible controls, and does not change the legacy output.
- [x] Supply the six optimized owner assets; record hashes/bytes/dimensions and owner-supplied provenance.
- [x] Generate a clear settings gear raster with real alpha; optimize 2x/3x; inspect at 22–24 CSS px.
- [x] Implement v2 header using existing BrandLogo/Typography/ChildAvatar; one shape/geometry in Feed/Family.
  Retain settings only where a callback exists, no invented navigation or artificial OS bars.
- [x] Run tests, typecheck, lint and visual header fixture at 320/390/430 across covers.
- [x] Lead inspect actual diff/assets, independent review and fresh confirmation review.
  Only assigned paths are included in the local task commit; no push/hosting/main merge.

Stop: requires changes to child avatar transport/crop contract, backend preferences or provider auth.

## Task 2 — application skin, fixed palette and navigation

Worker ID: UIM-02; depends on task 1 accepted interfaces.
Modify: webapp/src/features/theme/ThemeProvider.tsx,
webapp/src/components/BottomNavigation.tsx, webapp/src/styles/tokens.css,
webapp/src/features/memoly-ui/memoly-ui.css,
webapp/src/features/feed/presentation/FeedPresentation.tsx,
webapp/src/features/memoly-ui/FamilyPresentation.tsx.
App.tsx only if an existing settings callback must be threaded through a new optional presentation prop;
one assigned composition owner. Tests: design-system.test.tsx, theme.test.tsx, family E2E.

Interfaces: existing BottomNavigationProps/add ref and role capabilities remain;
new v2 CSS root attribute is scoped by readUiVersion, not a user preference override.
FeedPresentation may add onOpenSettings?: () => void supplied by an existing controller action.

- [ ] Pin legacy navigation/role and host-inset baseline before changing presentation.
- [ ] Install fixed palette tokens only in v2 scope; cover changes cannot alter accents.
- [ ] Add floating selected pill/round Add navigation, keeping three positions and Viewer read-only state.
- [ ] Adapt Feed/Family shell and unread control without duplicate scroll surfaces or stale warm navigation.
- [ ] Verify focus-return refs, host Back and safe-area max rules; 320–430 screenshots both modes.
- [ ] Lead review/check/commit, fresh task worker ends.

## Task 3 — real memory cards and reactions

Worker ID: UIM-03; depends on task 2.
Modify: features/feed/presentation/MemoryCardPresentation.tsx, MemoryReactions.tsx, memoly-feed.css,
NoteStoryPresentation.tsx only for agreed visual changes. Tests: feed.test.tsx and reaction browser cases.
Interfaces: retain MemoryCardPresentationProps, MemoryDto and typed mutation callbacks; media remains ReactNode.

- [ ] Pin live author/avatar/time/body/action slot and empty/long caption regressions.
- [ ] Implement soft card/anatomy, photo author, caption and live reaction totals using production models.
- [ ] Preserve long-press cancellation, one reaction/write ordering, errors and account-scoped cache.
- [ ] Preserve delete-preview/focus/seen refs; no fake counts, comments or bookmarks.
- [ ] Verify photo, note, voice, video and mixed types with real controllers/synthetic API test responses.
- [ ] Lead deterministic checks, independent review/confirmation and commit.

## Task 4 — media viewers and voice/video controls

Worker ID: UIM-04; depends on task 3.
Modify: webapp/src/features/feed/FeedPage.tsx helpers MixedMediaViewer, TelegramVideo, MaxVideo,
PhotoImage, AudioPlayer, VoiceSeek, PrivateVideo and MemoryDetail (presentation only);
webapp/src/features/feed/presentation/memoly-feed.css.
Tests: webapp/tests/feed.test.tsx and webapp/e2e/specs/feed.spec.ts.
Keep playback.tsx, playback-context.ts, use-playback-registration.ts, max-video-source.ts,
max-video-readiness.ts and voice-waveform.ts unchanged unless a confirmed integration regression demands it.
Interfaces: retain FeedPage queries and media engines; do not export/use simulated Lab VoiceSurface.

- [ ] Pin media-source orientation, readiness/expiry/error cases before restyling.
- [ ] Match visual controls while preserving HTML audio/video buffering, seek, captions and mixed order.
- [ ] Keep original uncropped media in viewer; lazy-load/provider source/reset and no unintended autoplay.
- [ ] Validate loading/error/checking, swipe/keyboard close and return to originating memory.
- [ ] Run appropriate media tests, inspect real browser controls, review/commit.

## Task 5 — family, child/member profiles and settings

Worker ID: UIM-05; depends on task 2 (execute after task 4 in this shared worktree).
Modify: webapp/src/features/memoly-ui/FamilyPresentation.tsx,
webapp/src/features/family/ChildProfile.tsx and ChildProfile.css,
webapp/src/features/family/FamilyOnboarding.tsx,
webapp/src/features/memoly-ui/MemberProfile.tsx and member-profile.css,
webapp/src/features/memoly-ui/SettingsSheet.tsx and memoly-ui.css,
webapp/src/features/memoly-ui/FamilySettingsPage.tsx;
App.tsx inline UI changes only through assigned composition owner. Tests: family/profile/member suites + E2E.
Interfaces: reuse existing family/member/child DTOs, capability checks, crop and settings callbacks.
AppearanceChoices currently consumes MEMOLY_THEMES; retain packages/contracts/src/auth.ts
memolyThemeSchema unchanged and keep auth updateTheme calls. Only labels/previews/v2 palette change.
Tests: settings-presentation.test.tsx, family-management.test.tsx, member-profile.test.tsx,
child-profile.test.tsx, family-onboarding-error.test.tsx and e2e/specs/family.spec.ts.

- [ ] Pin Owner/Full/Viewer actions and long/missing/changed identity regressions.
- [ ] Adapt rows/forms/privacy/settings to the same fixed v2 skin.
- [ ] Replace six color choices with six artwork previews using existing preference IDs/API.
- [ ] Keep owner-only child/family management, member aliases/roles/removal, avatar crop and save errors.
- [ ] Check family/account switch purges old private assets; lead checks/review/commit.

## Task 6 — onboarding, invitations, composer and remaining flows

Worker ID: UIM-06; depends on tasks 3/5.
Modify: webapp/src/features/family/FamilyHubPage.tsx, InvitationScreens.tsx;
webapp/src/features/composer/PhotoComposer.tsx, NoteComposer.tsx, ComposerForm.tsx, MemoryEditor.tsx;
webapp/src/features/max-video-upload/VideoComposer.tsx;
webapp/src/features/memoly-ui/FamilyInvitesPage.tsx, FamilyArchivePage.tsx, FamilyPresentation.tsx;
webapp/src/features/pwa-install/PwaInstallPrompt.tsx.
Host/browser auth views BrowserLinkLogin, MaxBrowserLinkAuthFailure, MaxBrowserLinkApproval,
OpenInTelegram remain inline in App.tsx; only their presentation is assigned to one worker at a time.
Inherited password login/register/reset template routes are not active memoLy surfaces and are excluded.
Narrow each subtask allowlist at dispatch; do not give a worker the entire App/controller as editable scope.
Interfaces: current auth/join/upload/edit/install/host callbacks and data contracts only.

- [ ] Inventory current live screens/states against the Lab matrix; do not assume every Lab demo is production.
- [ ] Migrate in small separate workers per flow if the scoped diff is too large:
  UIM-06A entry/families/invites; UIM-06B composer/edit; UIM-06C channel/archive/install.
- [ ] Preserve explicit Join privacy, real signed host/browser auth and actual upload lifecycle/cancellation.
- [ ] Preserve edit conflict/date/media order, delete gating and focus; no fabricated success.
- [ ] Audit small icons in every modal/form/footer at actual size, both light/dark viewer surfaces.
- [ ] Unit checks: family-hub.test.tsx, family-invite-submit/result/link.test.ts, family-max-channel.test.tsx,
  pwa-install.test.ts, photo-composer.test.tsx, browser-auth-screen.test.tsx, welcome-splash.test.tsx.
  Browser checks: e2e/specs/welcome.spec.ts, family.spec.ts, mm1-mixed-composer.spec.ts.
- [ ] Targeted tests and browser screenshots, review/check/commit per bounded subtask.

## Task 7 — preview build and safe hosting plan

Worker ID: UIM-07 (delivery specialist); depends on all presentation tasks accepted.
Read docs/DEPLOYMENT.md and deploy/selectel/README.md. New preview-specific plan/scripts, if needed,
are isolated from production main-only workflow/compose ownership.

- [ ] Build legacy and v2 at the same exact feature SHA; save nonsecret checksums/UI mode.
- [ ] Keep preview artifacts in separate SHA/mode/checksum identities. Current Selectel images are
  SHA-only and Dockerfile does not accept the new mode argument: never overwrite production tags
  or assume a runtime environment variable changes a compiled Vite bundle.
- [ ] Confirm preview hostname/runtime choice with owner against the prepared reviewable bundle.
  Existing repository has NO documented staging environment; do not claim one is ready.
- [ ] Prepare separate-origin HTTPS preview, isolated DB/storage/test auth, protected access and
  no production webhooks/bot/private families. Explicit owner approval for actual host changes/paid resources.
- [ ] Keep production guard unchanged; prove preview can be removed/switched to legacy without touching data.
- [ ] Publish only when the actual destination/access authorization exists. Record exact SHA/environment/smoke.

## Task 8 — full branch/device acceptance and release decision

Worker ID: UIM-08 fresh reviewer, no implementation history.

- [ ] Check full active diff vs base, both UI modes, no Lab/demo imports, asset budgets/alpha/SVG absence.
- [ ] Run typecheck/lint/build, architecture/template and required verify-required checks on current head;
  affected complete frontend regression/E2E sets. No all-skipped/missing checks counted as green.
- [ ] Owner inspects browser, PWA, Telegram/MAX test contexts and real devices after preview delivery.
- [ ] If rejected: preserve branch, leave main/production untouched, fix in bounded tasks.
- [ ] If accepted: merge origin/main safely if advanced, repeat affected checks and fresh review.
- [ ] Prepare the explicitly approved v2-default activation commit, preserve invalid-value legacy fallback,
  build the ordinary release Docker path and preview/check the exact final SHA again.
- [ ] Only owner/designated integrator squash-merges after current-head green checks and owner approval.
  Production deployment is a separate confirmed release of accepted main, with compatible frontend rollback.

## Initial task ledger

| Task | Status | Evidence |
|---|---|---|
| Setup/discovery | Complete | Clean separate branch from accepted main; frozen install; 91 baseline passes |
| UIM-01 | REVIEW | First slice and lead checks complete; two fresh reviews passed; retained locally |
| UIM-02…06 | Planned | Sequential bounded workers; no shared-write race |
| UIM-07 | Planned | No staging yet; destination/access approval required before hosting changes |
| UIM-08 | Planned | Main merge/production release not authorized here |

Agents get only SPEC.md, their task block, current base/head, explicit allowed/forbidden paths,
2–5 relevant reference files and test commands. Do not fork the entire chat into implementation workers.
