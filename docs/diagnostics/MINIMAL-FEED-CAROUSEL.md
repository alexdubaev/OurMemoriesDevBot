# Minimal feed carousel continuation

Task: `MEMOLY-PWA-MINIMAL-UI-EXPERIMENT`; branch `experiment/pwa-minimal-feed`; allowed worktree `.worktrees/pwa-crash-diagnostics`. Base: `a30ead903d7ef6d61fabac6a226dfd33702c2d04`; unchanged main: `920f223fae0216be6a92b6c3ad2199c87bad0c0a`.

The owner reported that the first physical run of the root experiment did not hang. They requested carousel navigation and video previews before further testing. This observation does not establish the cause of the earlier white screen.

Acceptance follows the previous fixes `f712f20` and `ac33098`: full card width with natural media proportions, no cropping, distortion or fixed small frame, dot navigation beneath the media, and retained per-attachment aspect ratios while an unknown video poster loads and when revisiting slides. The experiment keeps its independent CSS/import graph, the existing `usePrivateImageUrl` lifecycle, private media access, API/query scope and worker.

The authorized delivery remains temporary root mode. Previous experiment source `f6db4c15a5fe486a996fd298f27d511c18723a2e` remains available through `activate <sha> root`; `off` restores the original product. No backend, schema, auth, ACL, MAX storage or standard UI source changes are part of this continuation.

The carousel uses the existing CSS-free Embla controller with its own plain viewport, track and dots. Selection by dots and focused keyboard navigation jumps directly; swipe uses the existing controller. No product visual component or stylesheet is imported. The build's CSS/module allowlist remains the acceptance boundary.

Private-storage previews use `displayPath ?? previewPath`; MAX previews use the existing poster fields, readiness schemas, scoped query keys and concurrency helper; Telegram retains its private thumbnail and guarded open action. Playback uses the existing private-media bootstrap. Poster paths stay stable while a slide is inactive; the existing image hook's `enabled` option gates loading, preserving its owned URL lifecycle and allowing a decoded poster to remain usable on return.

The focused local browser fixture combines real authenticated feed/image/cache/SW/pagination paths with a local-only pending-video DTO backed by an uploaded synthetic portrait image. A test-only fetch gate delays this asset to verify the unknown-aspect transition and return. This does not exercise external MAX readiness or playable provider media. Production has no fixtures, fetch interception or new diagnostics. Actual MAX poster/playback and iPhone swipe acceptance remain for the owner.

## Verification

- Webapp/application/E2E typecheck passed. Isolated build and emitted-artifact guard passed: three files, one diagnostic stylesheet, no product manifest or worker.
- Final focused browser closure passed: 1/1, 15.2s, exit 0. It verifies the real restored MAX session, private image decode, mixed photo/pending-poster selection, retained height during the delayed response, natural portrait geometry, selected dot/slide agreement on return, existing SW control and successful cursor pagination through note 21.
- Local test-only fixture boundaries are explicit above. Native playable video teardown and external MAX readiness remain implementation/review evidence pending the owner's device test; the test does not claim their live provider acceptance.
- One fresh independent review reported no P0/P1/P2 findings. The lead's final visual closure caught a revoked poster URL on return and inconsistent native selection; the bounded closure preserves the hook's stable path and uses the existing Embla selection controller. A narrow closure review reported no P0/P1/P2 findings; no second whole-change audit was run.
- Evidence: `.scratch/minimal-feed/carousel-closure.log`, `carousel-typecheck.log`; inspected viewport screenshot `webapp/e2e/.artifacts/minimal-feed/test-results/diagnostic-feed.experiment-0265a-d-the-existing-media-worker-chromium/diagnostic-feed-carousel-poster-viewport.png`. The screenshot shows the synthetic portrait at the full 688px available card width with the second dot selected. It is desktop Chromium evidence.
- The final test run initially encountered an orphan empty Prisma generation lock. After verifying no generator process remained, the lead removed only that lock inside this allowed worktree and reran the same narrow test. No product or database changes were used to bypass the check.

## Delivery receipt — 2026-10-13 04:35 UTC

- Active experiment source: `78da662665a7ba3bd7487d884c37752bc57f4ed7`, mode `root`, ordinary address `https://app.memoly.ru/`. Branch `experiment/pwa-minimal-feed`; no PR or main merge. Allowed changes: diagnostic feed/CSS, focused E2E, this document.
- Server artifact is immutable under `/opt/memoly/experiments/minimal-feed/releases/78da662665a7ba3bd7487d884c37752bc57f4ed7/`. HTML/JS/CSS checksum verification and activation exited 0; the existing helper is unchanged.
- Version rollback to `f6db4c15a5fe486a996fd298f27d511c18723a2e` and reactivation of this version both passed (exit 0). The prior version returned its recorded HTML checksum. `off` remains the previously verified original-interface rollback.
- Public root smoke passed: HTTP 200, query/fragment preserved, one diagnostic CSS asset, no page errors. Existing SW/runtime-witness hashes and all five normal service container/image identities match the pre-experiment baseline; health passed. No migrations or backend/ACL/auth source changes.
- Emitted artifacts: HTML `5b12edbec2e52a33d25bed1b09406d3bce4eb69f1bef437c43792b77ea9ab5b2`; CSS `diagnostic-feed-7A88TrjN.css` (2.50 kB) `19585598ba869960ab257ff1d57770a035187e1f09d5681f8e421b74a4e9c911`; JS `index-HQQwP9cS.js` `e3e3815fc841bd51f614e5cbe610db73f4a4b070cd772606c863de6c74c5b76d`.
- Delivery evidence: `.scratch/minimal-feed/carousel-{activate,version-rollback,public-smoke}.log`, `carousel-production-after.txt`. Device acceptance for this carousel version remains pending. The earlier owner report of no hang applied to the version without this carousel.
