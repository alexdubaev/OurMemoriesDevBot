# Android layout and meadow implementation plan

Task: MEMOLY-ANDROID-LAYOUT-MEADOW. Base: 0486e79947f6612d0eed05207c1cd30d0c4ace65.
Branch: fix/android-layout-meadow. Worktree: .worktrees/android-layout-meadow.

Goal: remove the undecorated Android header gap, use compact Android navigation, and present existing default mint as Meadow without changing saved preferences.

Architecture: retain shared screens/navigation and the existing MAX bridge. Presentation owns platform selection and resize-driven inset refresh. CSS combines host and browser safe areas by maximum, once. Android header decoration includes its safe region while controls remain below it; iPhone geometry stays unchanged.

- [ ] Reproduce baseline in the existing browser harness and record actual coordinates. Distinguish simulated host inputs from physical-device evidence.
- [ ] Delegate one bounded implementation: presentation layout helper/refresh, App presentation wiring, CSS header/nav/content reservations, mint label/art mapping and valuable regression checks. No auth, API, ACL, media, persistence, dependencies, backend or release-tooling changes.
- [ ] Verify narrow regressions, actual diff, all five navigation actions, default/selected themes, safe insets, resize/orientation and simulated keyboard. Inspect screenshots; do not claim physical MAX acceptance.
- [ ] Obtain one fresh independent technical and exact-range FRONTEND semantic review. Register receipts against actual deployed backend/frontend bases.
- [ ] Run the documented FRONTEND command on the immutable candidate, publish PR evidence, squash merge against current main, compare trees and verify final release SHA.
- [ ] Deploy with versioned guarded frontend entry point, confirm retained backend, public smoke, manifest and frontend recovery readiness. Safely clean only this task's branch/worktree after confirmed integration.

Baseline: Chromium 390x844, simulated top=48/bottom=24: undecorated frame y=0/paddingTop=48, header y=48/h=122, controls y=56/h=44, nav h=74 (50 content +24 safe). The source's legacy nav token is 96 but active UI v2 overrides it to 50. No physical Android/iPhone is connected. MAX normalizes safe/content insets with max, not sum. Theme settings label mint as Meadow but the header/config use old mint artwork; the hub already uses meadow artwork.

Acceptance: Android navigation base 64px plus max(host,browser bottom), targets >=44px; preserve current iPhone navigation. No negative margins/model offsets. Header artwork starts at the viewport content origin, controls remain within safe bounds. Existing mint server default/state logic stays intact; only mint display name and illustration change. Other choices remain available. Stop and report before FULL if accumulated production diff exits the frontend boundary.

Verification command: bun run verify:local --profile frontend --base <deployed backend SHA> --frontend-base <deployed frontend SHA> --frontend-review <external receipt directory> --journey webapp/e2e/memoly-v4.spec.ts --journey-grep "feed and family navigation expose working controls". Supplement with narrow helper regressions and targeted browser geometry/interaction checks.
