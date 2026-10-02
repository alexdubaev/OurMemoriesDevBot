# UNIFIED-AVATAR-CROPPER-REACT-EASY-CROP

Status: IN_PROGRESS. Owner authorizes implementation, PR, squash merge, canonical deployment and read-only runtime verification. Physical device acceptance remains with the owner.

- Base: `329d6b9ccb7616adc6c5c75d2781db62400a5f32`, fetched from canonical origin on 2026-10-02.
- Branch: `feat/unified-avatar-cropper`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/unified-avatar-cropper`.
- Lead: current task model; delegated implementation: worker; independent scoped review: reviewer.
- Existing main checkout has unrelated untracked work; leave it untouched.

## Accepted implementation

1. Add only `react-easy-crop` 6.2.3 (registry latest, MIT, React peers >=16.4; application React 19). Create one presentation-only fullscreen AvatarEditor, aspect 1, round mask, no grid, drag/pinch, slider, reset, 44px semantic controls and host safe areas. Limit gesture suppression to its surface. Use percentage coordinates converted to normalized rectangles and restore through initialCroppedAreaPercentages. Rotation is omitted because existing child crop contract does not carry it.
2. Replace the child manual crop engine and arrows with a thin adapter. Keep original media, square validation, expectedVersion and VERSION_CONFLICT authoritative. Support editing an existing full image without selecting a file. Cancel must leave server state unchanged; retain editor state on failed confirmation.
3. Reuse one self-avatar flow for AvatarPanel and MemberProfile. Add nullable crop JSON to the existing UserAvatar, with an additive migration and own-user crop endpoint protected against replacement races. Publish the original and crop together on confirmed upload. Keep existing remove behavior.
4. Use a shared exact normalized-rectangle renderer for child and adult surfaces. Carry crop through family/member and memory-author contracts. Null adult metadata retains the legacy presentation. Keep the existing query/event/private-image architecture and refresh crop metadata immediately without a page reload.
5. Preserve existing formats and size limits (child 20 MB; adult 5 MiB). Verify HEIC/HEIF decoding; if necessary use existing server image dependencies for bounded, transient normalization without storage reservations or persisted writes before confirm. Preserve original bytes. Apply EXIF orientation once.

## Ownership and scope

One implementation worker owns all changed files, including proposed shared changes, which the lead accepts through actual diff inspection. Allowed: avatar feature, child avatar adapter/renderer, avatar-only blocks of member profile and avatar props on display consumers, avatar contracts and DTO mappings, uploads avatar backend, avatar-only media delivery support, necessary image helper, nullable schema/migration, webapp package and lock, relevant tests and report. Forbidden: UI v2 Lab, design/ui-v2-react-lab, unrelated layouts/profile fields, MAX, video, authentication architecture, general cache architecture and any other user's work.

## Verification and acceptance

| Outcome | Required evidence |
| --- | --- |
| Editor | Open; 1:1/round; drag; zoom; reset; normalized Done; cancel; restore; duplicate confirm protection |
| Child | Existing recrop; replacement; cancel; retry; version conflict; legacy metadata |
| Adult | Add; recrop; replace; remove; retry; cancel; own account only |
| Display | Matching crop on child header/family/feed/profile and adult profile/member row/memory author; no reload |
| Formats | JPEG/PNG/WebP policy; HEIC/HEIF actual decode; portrait/landscape and EXIF |
| Browser | Chromium and WebKit; widths 320/360/390/430; synthetic screenshots; touch emulation evidence described accurately |
| Gates | Targeted webapp/backend/contracts tests; affected typechecks; lint; build; architecture/template; required CI current head |
| Review | One fresh scoped independent reviewer per owner instruction; fix confirmed P0/P1/P2 and verify |
| Delivery | Fetch/reconcile fresh main; task push and PR; green current-head required check; squash merge; reviewed Selectel ci-release entry point |
| Runtime | Exact runtime/frontend/backend SHA, readiness/liveness, migration total/applied/pending and sanitized startup error check; no production avatar mutations |

Stop the affected work for inaccessible originals requiring broad architecture changes, proven runtime incompatibility, destructive migration, security/ACL risk or substantial media architecture change. Deployment also obeys the canonical runbook's actual environment gates. Do not bypass checks or invent release commands.

Final report records actual counts, exit codes, review findings, SHA values, screenshots and limitations. Physical iPhone and Android MAX pinch and restore remain DEVICE ACCEPTANCE REQUIRED.

## Lead verification evidence

- Template check and architecture check: exit 0; architecture checked 790 source files.
- Contracts: 55 pass, 0 fail, 223 assertions across 6 files, exit 0.
- Full webapp after the percentage-boundary regression fix: 449 pass, 0 fail, 3162 assertions across 70 files, exit 0.
- Webapp typecheck, lint and production build: exit 0 on the current implementation.
- Targeted backend avatar/image/member-content unit tests: 10 pass, 0 fail, 29 assertions across 3 files, exit 0.
- Lead Chromium mobile emulation via actual CDP touch events, including the application's existing zoom-prevention listeners: one-finger drag changes image transform; two-finger pinch increases zoom 2 to 3; page scroll remains x=0/y=0; exit 0. This is emulation, not physical device acceptance.
- Scoped contrast and 320px crop-surface geometry corrections were visually checked. Synthetic screenshots: `unified-avatar-cropper/webkit-320-portrait.png` and `unified-avatar-cropper/chromium-390-landscape.png`.
- Fresh main now includes `4b5760e` (MAX forward import). Reconciliation will preserve that accepted change without extending this avatar task's scope.

- Worker browser matrix: 38/38 pass, exit 0 (18 core editor, 12 child, 8 adult across Chromium and WebKit).
- Three focused full-stack cases: own account add/replace/recrop/remove 1/1; participant row/profile/memory-author crop 1/1; child recrop/CAS/hub/replacement-cancel 1/1. Exit 0. Browser artifacts remain ignored under `webapp/e2e/.artifacts/`.
- Worker backend typecheck: exit 0. Upload integration: 17/17; member-avatar DTO/ACL integration: 1/1, exit 0. Warm private-cache browser regression: passed, exit 0.

Independent review, required CI and release evidence are recorded when completed. Physical iPhone and Android MAX acceptance remains pending.
