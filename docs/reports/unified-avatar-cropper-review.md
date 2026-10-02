# Avatar scoped review and lead disposition

Task: UNIFIED-AVATAR-CROPPER-REACT-EASY-CROP. Original base: `329d6b9ccb7616adc6c5c75d2781db62400a5f32`; reconciled base: `4b5760ed1f5b7215b8241384142d9ed3c4e562d1`. Branch/worktree: `feat/unified-avatar-cropper`, `.worktrees/unified-avatar-cropper`. Implementation: GPT-6 Luna worker; independent review: fresh GPT-6 Luna reviewer, read-only. One fresh scoped review followed by the same reviewer's narrow closure check.

Reviewed implementation head: `26e817ddc589f78cf803425d3dccd0a7ee8f5169`. Reviewed fix head: `526a99498798840924b7d683ef597f90aef5f164`. PR: https://github.com/alexdubaev/OurMemoriesDevBot/pull/148.

## Findings and disposition

P0: 0. P1: 0. The independent reviewer reported two P2 findings:

1. Body-limit middleware lost its returned Response, producing 500 instead of 413 on oversized requests. Fixed by returning the middleware Response. Lead and reviewer verified the existing Telegram/MAX/account size gates, without changing authentication rules or limits.
2. New 40MP normalization caused previously accepted adult originals to fail display. Fixed for JPEG/PNG/WebP through original-byte/MIME delivery, including a finalized 48MP JPEG and PNG alpha. HEIC uses bounded normalization when possible and original-byte native fallback otherwise; new selection probes actual browser decode before requesting transient normalization.

The closure reviewer confirmed the first finding, raster compatibility, native preview cleanup, and the owned editor URL lifetime, but kept the non-native HEIC >40MP subset open. The lead adjudicated that subset against the actual accepted baseline rather than starting another review loop:

- At base `4b5760e`, `MediaService.memberAvatarContent` returned original HEIC bytes and MIME, and `AvatarPanel` used the original signed download via `useAvatarImage`. A browser unable to decode those bytes was already unable to show the same avatar.
- Native-supported HEIC originals retain native probing and original MIME/bytes; they are not restricted by server display decoding. Browsers lacking native decoding receive JPEG when the bounded server decoder succeeds.
- The existing child photo processor already used a 40,000,000-pixel cap. No byte-size or format contract is narrowed by this change.
- Therefore the remaining non-native >40MP case is a pre-existing runtime limitation, not a confirmed regression. Server fallback above that cap is not claimed. Physical iPhone and Android MAX HEIC/HEIF acceptance remains required.

No confirmed P0/P1/P2 remains after fixes and this evidence-backed lead disposition. This is technical review, not an independent GitHub approval or physical-device PASS.

## Verification

- Lead final focused backend: 32 tests, 143 assertions, exit 0. Reviewer independently ran the corresponding backend boundaries and auth size tests successfully.
- Upload integration: 18 tests, 114 expectations, exit 0; includes finalized 48MP original delivery and original PNG bytes.
- Lead crop/native-preview unit tests: 6 tests, 21 assertions, exit 0; native success, rejection fallback and abort release probe URLs.
- Initial Chromium/WebKit matrix: 38/38. After fixes, existing adult recrop and delayed cache invalidation: 4/4, exit 0. Reviewer independently passed the two delayed-invalidation cases.
- Editor snapshots original/crop/id/version into an adapter-owned URL; a private image URL change cannot revoke the open editor image. The general cache hook is unchanged.
- Webapp/backend typecheck, webapp lint and final production build: exit 0. Lead native EXIF6 dimensions and pixel-direction checks pass in Chromium and WebKit. Lead actual CDP touch drag/pinch with the application zoom-prevention listeners passes, with page scroll remaining zero.
- Required CI runs on the final pushed head; merge and canonical deployment wait for success. No production user avatars are changed by automated verification.

## Owner device acceptance

Physical iPhone and Android MAX: child/adult existing recrop without selecting another file, one-finger drag, two-finger pinch, slider, save, reopen and restore; replacement cancel and replacement save; matching crop on Family/Feed/profile; representative JPEG/PNG/WebP/HEIC/HEIF and phone EXIF orientation. DEVICE ACCEPTANCE REQUIRED.
