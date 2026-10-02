# memoLy UI v2 — production migration

Task: MEMOLY-UI-V2-PRODUCTION-MIGRATION. Owner assignment: 2 October 2026.
Accepted base: 329d6b9ccb7616adc6c5c75d2781db62400a5f32.
Branch: feat/ui-v2-production-migration. Worktree: .worktrees/ui-v2-production-migration.
The owner's later request authorizes production migration and a fresh bounded agent per task.
It supersedes the older Lab-only restriction for this NEW task; Lab remains separate.

## Product result

Implement the approved live Feed composition: watercolor child header, official logo, round avatar,
warm cream surfaces, large media card, caption/reactions, floating Feed/Add/Family navigation.
One cream/sage palette applies throughout. Six owner-supplied headers change only artwork.
Map existing signed-in user theme identifiers to covers; do not change public contracts or preference
storage. Preserve real child/member portraits, cropping and all memory content.
User explicitly rejected the current small settings icon. Replace it with a clear raster gear and audit
all small icons at their actual rendered sizes, especially settings, back, more, close, home, family, plus.
No SVG, icon fonts, SVG sprite/data URL or new icon library. WebP RGBA with real transparent backgrounds.

## Architecture and safety

Use production presentation seams rather than importing the Lab bootstrap, fixtures or local mock actions:
ChildHeader, BottomNavigation, FeedPresentation, MemoryCardPresentation and FamilyPresentation.
Existing App/FeedPage controllers remain the source of auth, live queries, permissions, media access,
pagination/unread state, optimistic reactions, mutations and host lifecycle.
Use the existing HTMLMediaElement/provider integration; never replace it with simulated Lab playback.
Keep existing media orientation/containment and full viewer behavior even where a demo photo is cropped.
No backend/schema/migration changes, no server enum changes, no new dependencies in this migration.

Add a build-time VITE_MEMOLY_UI_VERSION=legacy|v2 switch, default legacy; invalid values fall back to legacy.
The switch is separate from the user's cover preference and is NOT a privilege/auth switch.
Keep legacy presentation intact while migrating. Both modes share the same business controllers.
No query-string/localStorage override to production UI mode.
Each completed stage may be previewed in v2, but a partial migration is clearly labelled in the report.

## Delivery and rollback

Keep app.memoly.ru and its current accepted release unchanged during preview.
Current production workflow accepts only current main SHA; do not weaken that guard for branch delivery.
A separate preview HTTPS hostname/runtime is needed before uploading an unmerged feature branch.
Preview uses synthetic test data, isolated DB/storage/session scope and no production bot/webhooks.
Authenticated Telegram/MAX preview requires approved test platform URLs and existing test identity setup.
No extra bot, paid infrastructure or live host deployment is created by this planning/initial task.

Before preview promotion record exact branch SHA, bundle checksum, UI mode and environment.
If design is rejected: leave production unchanged, keep this branch for improvements, return testers to
the old address or rebuild preview with legacy mode. No data restore or destructive Git operations.
If accepted: refresh from main safely, run current-head checks/review, owner approval, squash PR into main,
then release the accepted main SHA through the existing deployment process.
Post-release fallback is the compatible prior frontend artifact through the reviewed release procedure,
or a newly reviewed rollback commit on main that restores the legacy default. Frontend rollback does
not restore/erase family data. Never overwrite a production SHA image with a different UI-mode build.
Current Selectel Dockerfile does not forward the UI-mode build argument and image tags are SHA-only:
preview modes therefore use separate preview artifact identities, not production image tags.
Before first production release, an owner-approved activation commit makes the default v2. Verify that
exact commit again in preview/default Docker build before merging/releasing; invalid values stay legacy.

## Acceptance

- Feed/Family share stable header geometry across six covers, 320/360/390/430px and host insets.
- Live signed-in name/avatar/age, role gates, unread/pagination and reconnect behavior survive.
- Photo/video/mixed/voice/note viewing, upload/edit/delete, reactions and account isolation survive.
- Invites, member roles, profile settings, web access and install flows keep their actual capabilities.
- 44px targets, AA text contrast, real keyboard focus, host Back, reduced motion and safe areas.
- No new SVG in supplied v2 UI. Small icons have legible silhouettes, true alpha, 2x/3x files and budgets.
- Both legacy and v2 builds typecheck/lint/build; affected domain/browser tests pass on exact head.
- No dev fixtures or generated demo people/media enter the production app bundle.
- Owner visual/device review is required before main merge or production deployment.

## References and initial evidence

Approved composition: latest Feed screenshot shown in this conversation with header-bunny-meadow.
Lab reference branch: design/ui-v2-react-lab, committed head 90a05a4; later owner-preview crop is local.
Owner assets were optimized separately without changing dimensions or originals: six WebP files,
161562 bytes in total (12–46KB each), with hash report in Lab docs/design/ui-v2/optimized-headers.
Assets are opaque full-background illustrations; icons require RGBA. Do not invent alpha for artwork.
Initial baseline: 91/91 tests passed in theme.test.tsx, design-system.test.tsx and feed.test.tsx, exit 0.
Origin is the verified canonical alexdubaev/OurMemoriesDevBot repository.

Allowed production boundaries: webapp/src/components/**, feature presentation/CSS, features/theme,
new features/ui-version, dev visual fixtures, webapp/tests and e2e, webapp/public/assets/ui-v2,
docs/design/ui-v2-migration. Composition root changes have one explicitly assigned worker at a time.
Forbidden by default: backend/**, packages/contracts/**, schema/migrations, lockfile/package manifests,
production release guard edits, existing secrets/config values and unrelated dirty work.
