# UNIFIED-AVATAR-CROPPER-REACT-EASY-CROP

Status: REVIEW. Owner authorizes implementation, PR, squash merge, canonical deployment and read-only runtime verification. Physical device acceptance remains with the owner.

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
5. Preserve existing formats and size limits (child 20 MB; adult 5 MiB). JPEG/PNG/WebP are displayed as original bytes, retaining PNG alpha and browser-native EXIF orientation. HEIC/HEIF selection probes native browser decoding, then falls back to existing bounded server normalization (40MP) without storage reservations or persisted writes before confirm. Existing HEIC delivery retains an original native-browser fallback if normalization is unavailable. Preserve original bytes; do not claim unsupported native/mobile runtimes have passed.

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

## Reconciliation and independent review

Fresh main `4b5760ed1f5b7215b8241384142d9ed3c4e562d1` was merged without conflicts. Reconciled head: `26e817ddc589f78cf803425d3dccd0a7ee8f5169`. Backend typecheck, architecture (793 source files), template and whole-diff whitespace checks passed, exit 0. Migration directories after reconciliation: 47.

PR: https://github.com/alexdubaev/OurMemoriesDevBot/pull/148 (draft while gates are running).

One fresh read-only GPT-6 Luna reviewer inspected the whole active avatar diff. P0: 0; P1: 0; P2: 2, accepted by lead for bounded fixes:

1. `backend/src/http/security.ts`: return the body-limit middleware Response instead of discarding it. Required CI run 37070312448 had 600 backend unit tests pass and 3 fail: oversized auth/account bodies returned 500 rather than 413.
2. `backend/src/storage/normalize-avatar-image.ts`: valid adult originals beyond the new 40MP cap could finalize but become undisplayable. Review reproduced a 48MP JPEG of 281,517 bytes under the existing 5MiB limit. Preserve compatible original delivery and native preview support without unbounded server decoding.

The same reviewer will perform a narrow closure check after fixes; no second fresh review loop. Required CI and release evidence are recorded when completed. Physical iPhone and Android MAX acceptance remains pending.

## Review fixes verified by lead

- The body-limit Response is returned; existing auth/account size tests now produce 413. The avatar preview exemption remains exact method/path only.
- Adult JPEG/PNG/WebP delivery returns original MIME and bytes. The 48MP JPEG can finalize and return 200 unchanged; PNG alpha is retained. HEIC normalization remains bounded, with original-byte delivery fallback for native-supported existing photos. Selection probes native HEIC first and releases the probe URL on success, failure and abort.
- Lead additionally verified an editor URL ownership race: an existing adult crop now snapshots original preview, crop and CAS identity into an adapter-owned URL, so private-cache reconciliation cannot revoke an image still shown in the editor. The general cache hook is unchanged.
- Lead focused backend check: 32 pass, 0 fail, 143 assertions across 6 files, exit 0. Worker upload integration: 18 pass, 0 fail, 114 expectations, exit 0.
- Lead crop/preview unit check: 6 pass, 0 fail, 21 assertions across 2 files, exit 0. Worker focused adult existing-recrops and slow-invalidation lifecycle browser cases: 4/4 across Chromium and WebKit, exit 0.
- Webapp/backend typecheck and webapp lint: exit 0. Lead final webapp build: exit 0.
- Lead browser-native EXIF orientation=6 check: Chromium and WebKit both return oriented 80x120 dimensions and correct red/blue pixel direction from a 120x80 JPEG, exit 0. This verifies browser correction once, not physical phone acceptance.

Fixes are ready for the same reviewer's narrow closure check and a new required CI run.
