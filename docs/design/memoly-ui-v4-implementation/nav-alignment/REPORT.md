# MEMOLY-V4-BOTTOM-NAV-ALIGNMENT

Base6217ed499e0f54253b95e28a22e21927c14131cb, branchfeat/memoly-ui-v4-implementation, Draft PR185. Latest owner requirement prioritizes readable and usable navigation. Main is unchanged; no merge.

Only direct visual children of existing navigation buttons receive a relative vertical offset: min(5px,2px+effectiveBottomInset). This moves each icon/circle and caption together. At inset0 the shift is2px, leaving the complete Add caption within the viewport; inset1=>3px, inset2=>4px, inset>=3=>5px. Effective inset remains max(host,browser), with no additional reserved space. All three positions use the same rule on feed and family. Their pointer events remain on the unchanged button rectangle; the decorative children do not extend its hit area. Existing add-circle active scaling is retained.

Unchanged:50px visible panel including its1px top divider;49px-high button targets (minimum98.65px wide at320); active indicator coordinates; icons20px, add circle31px, caption font10px/line-height11px; themes/backgrounds; content clearance; safe-area padding; refs/handlers/roles. No other components, forms, media, carousel, API, auth, or database changes.

Lead's actual React comparison (Chromium DPR1, synthetic local data) covers12 states: feed/family ×320/390/430 ×inset0/34. All panel, grid, button, divider/indicator coordinates and visual dimensions/font metrics match the base. Every child moves2px at0 or5px at34. No caption exceeds the844px viewport: maximum label bottom843.5px at0,812.5px at34. See before/, after/, comparison.json. Additional focused assertions cover small inset transitions and text200%; results recorded in checks and PR update.

Desktop WebKit passed4/4 feed/family390×844 at0/34: same panel50/84 total, grid49, divider1, targets122×49, nooverflow, caption bottom843.5/812.5. Screenshots in webkit/ are explicitly desktop engine evidence, NOT physical iPhone/MAX acceptance. Physical device access remains unavailable.

The task-specific reviewed frontend-only operator keeps runtime backendaf6, shared deployment lock, exact source/image IDs, API/config compatibility and nonstatic container invariance. Previous frontend6217ed4/image7abc8cca is saved and canary-tested before switching. Existing main-only release guards are unchanged. No migrations, automated writes to real API, other service restarts, or Docker prune. Exact-HEAD FULL, deployed SHA/image/public smoke and rollback command are recorded in PR185 after source freeze. PR remains Draft pending the owner's acceptance.
