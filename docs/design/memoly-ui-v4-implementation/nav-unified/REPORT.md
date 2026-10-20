# Unified bottom navigation safe-area — owner correction

Task: MEMOLY-V4-UNIFIED-NAV-SAFE-AREA. Base74e5d5c504e28fae37441cc86cd199e651a045d2; existing feat/memoly-ui-v4-implementation, Draft PR185. No main merge.

The outer navigation now uses the same theme surface token as its inner row. The single1px divider belongs to the outer navigation top; the inner row has no border. Layout token, max(host,browser) inset, padding, components, handlers, media, roles and other UI are unchanged. Visible panel including divider remains50px at100% text, with49px-high controls. The inner grid is49px; one external1px divider makes50px. At34px effective inset the entire uniform surface occupies84px; no additional spacer is created.

Lead's focused desktop WebKit probe passed4/4 (feed/family390px × inset0/34): navheight50/84; outerborder1px, gridborder0; outer/grid computedbackgroundrgb(255,254,250); targets122×49; nooverflow. Evidence in webkit/measurements.json and screenshots. This is desktop WebKit with synthetic data, NOT a real iPhone or MAX WebView. Chromium responsive/200%-text checks and typecheck are recorded in the PR update.

Physical requirement remains OPEN: this session exposes desktop Chrome/IAB only; no connected iPhone, iOS device tool, or remote MAX Web Inspector is available. The owner was asked whether existing remote device/inspector access can be supplied. A physical screenshot or actual-device computed styles cannot be produced without that access. No desktop/emulated screenshot is presented as an iPhone screenshot.

Deployment uses the existing reviewed frontend-only path with exact immutable source/image and shared lock, preserving backendaf6 and all nonstatic container identities/configs. The rollback target is the current working74e5d5c frontend, saved and canary-tested before switching. Production UI flagv2, currentMAXusername and same-origin API remain. Generic main-only release/rollback guards are unchanged. No migrations, real-data automated writes, or Docker prune. Exact-HEAD FULL, deployment manifest, public GET smoke, image identity and rollback command are recorded in PR185 after source freeze.
