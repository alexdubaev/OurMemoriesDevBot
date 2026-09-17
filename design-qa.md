# memoLy Feed visual QA

final result: passed

## Comparison target and evidence

- Source visual truth: `D:\codex\memoly-kit-reference-20260917\memoLy-react-vite-kit` (React/Vite kit, `src/ui/MemoLyApp.tsx` + `src/ui/memoly.css`) and the approved Feed reference `C:\Users\Alexandr\.codex\codex-remote-attachments\01a0af34-8f4a-7d53-961e-b4e99a0b6066\CA6FA80F-D172-4147-AD0A-F2D284F7D7A2\1-Фото-1.jpg`.
- Source screenshot: `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\source-kit-feed-390x844.png`.
- Production screenshot: `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\production-feed-capture-390x844.png`.
- Same comparison input (side by side): `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\comparison-source-vs-production-390x844-v2.png`.
- Focused header/hero/filter comparison: `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\comparison-header-focused-390x360.png`.
- Source and production screenshots are each 390 × 844 PNG pixels, CSS viewport 390 × 844, deviceScaleFactor 1; no density conversion or resampling was used. The composite is 780 × 884 (40px neutral comparison gutter plus two 390 × 844 captures).
- State: authenticated seeded Feed with real `MemoryDto` records, child identity, Feed filter `all`, full-role Add navigation for the 390 production capture, and fixed bottom navigation visible. The seeded media is synthetic test media and is intentionally not the UI kit demo imagery.
- In-app Browser/CUA was attempted but unavailable because the browser request-header policy loader failed. Deterministic local Chromium/Playwright capture was used as the permitted fallback; the same route/state was still rendered and inspected from screenshots.

## Geometry and fidelity review

Full-view and focused comparisons checked header geometry, logo, child identity/avatar treatment, decorative cloud/stars, filters, date grouping, card bounds/rhythm, author rows, media/text split, likes/overflow, Add and fixed navigation, typography, colors, radii, shadows, and responsive density.

The post-fix 390 geometry matches the kit at the important anchors: hero x28/y95/w334, filter rail y244/h60, first card x22/y339/w346, and nav x0/y756/w390/h88. The 320 capture verifies the kit's narrow breakpoint (smaller logo/avatar and clipped horizontal filter rail); 430 and 480 captures show the wider density without horizontal page overflow.

## Comparison history

1. Initial implementation had a mobile root at x0 instead of the kit's browser-rendered x8 host margin, shifting hero, filters, date and cards and exposing an extra filter at the right edge. Fixed in `webapp/src/features/feed/presentation/memoly-feed.css` with the mobile host margin and matching shell height.
2. Initial cards were materially denser/different from the kit: no card padding/gradient, 36px author initials, larger/bolder metadata, flat like controls, and a missing date rhythm. Fixed with kit card padding/background, 42px author circles, 13px/11px author typography, 12px date headings, kit spacing, and kit-like like pills.
3. Note and voice cards did not use the kit's visual compositions. Fixed by adding the note icon/pill composition and a waveform audio pill while preserving the existing playback, seek, and registration handlers.
4. Child avatar lacked the kit's heart badge. Fixed by adding a presentation-only heart badge using the existing WebP icon asset.
5. Re-captured and compared after every actionable P1/P2 change. No actionable P0/P1/P2 mismatch remains.

## Intentional residual differences (P3 / dynamic content)

- Production uses real DTO identity and private media: seeded `Лиза`, initials fallback, orange MAX portrait video, and synthetic media differ from the kit's demo `Саша` photo/video assets. This is expected behavior/data fidelity, not a presentation drift; user-provided photos remain real media in production.
- Production uses the approved WebP icon pipeline (rather than the kit's inline SVG icon implementation), so tiny gear/heart/play glyph contours differ slightly while preserving size, color, affordance, and accessibility.
- Production viewer-role captures intentionally show the lock/`Просмотр` middle nav state; the full-role 390 capture shows the pink Add control matching the approved Feed reference.

## Responsive evidence

- `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\production-feed-320x844.png`
- `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\production-feed-390x844.png`
- `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\production-feed-430x844.png`
- `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\production-feed-480x844.png`

## Final interaction/console check

The relevant Feed E2E path passed with local synthetic PostgreSQL and Chromium. It exercised Feed loading, intrinsic media sizing, MAX preview/handoff, and bottom navigation. Existing Feed tests cover filters, pagination/retry, likes, delete, PhotoSwipe, voice progress, private video, Telegram video, role restrictions, and nav overlay constraints. No browser console error was observed in the capture run.

## Implementation checklist

- [x] New Feed presentation composition is used by production `FeedPage`.
- [x] Existing query/pagination, DTO, like/delete, private media, PhotoSwipe, playback/waveform, Telegram/MAX handoff, and role checks remain wired through the controller.
- [x] Source and production captures are normalized to the same 390 × 844 CSS/pixel viewport.
- [x] Responsive evidence captured at 320, 390, 430, and 480 widths.
- [x] No P0/P1/P2 findings remain; residuals are documented above.
