# MEMOLY-V4-COMPACT-BOTTOM-NAV

Owner correction within Draft PR #185. Base `33d1c2340873927b4f3a80ffd92aefdd3d642cb5`; branch `feat/memoly-ui-v4-implementation`. Main remains `f0a4e8ba3fa174f43c661ab2a70a6b744c6543f4`.

Only BottomNavigation.tsx, tokens.css, shared-skin.css and relevant existing React harness assertions change. The visible panel is 50 CSS px at text100%, including its border. Buttons measure49px high and >=98px wide at320px; the existing31px add circle, three positions, active indicator, refs/callbacks and Viewer restriction remain. Side icons20px, labels10px. Existing theme surface is preserved. No media/controller/auth/API/database code changes.

The effective inset is max(host,browser), once. It sits below the surface in opaque app canvas color. At34px inset:50px surface+34px canvas=84px total. Feed clearance78+inset; family overview50+inset. Child profile/management clearance follows the token plus50px. At text200% the token grows to68px to fit labels and maintain matching content clearance.

| Width | Panel before/after | Total with34px inset before/after | Feed padding0/34 after | Family padding0/34 after |
|---|---|---|---|---|
|320|62 / 50|96 / 84|78 / 112|50 / 84|
|390|62 / 50|96 / 84|78 / 112|50 / 84|
|430|62 / 50|96 / 84|78 / 112|50 / 84|

Evidence: `before/` and `after/` are actual React components with synthetic local data, Chromium DPR1, viewport height844. Each contains feed/family at320/390/430 and inset0/34, with measurements.json. Before/after comparison images show the390px viewport. These captures do not claim physical iPhone/MAX acceptance.

Narrow checks passed: four existing feed/family/profile/text scenarios, final feed scenario repeated after restoring the unchanged surface token, webapp typecheck, git diff --check. They cover 0/20/34 insets (including overlapping host/browser values), targets, roles, inactive indicator, last-card clearance, and text200%. A focused independent read-only review and exact-HEAD deployment FULL results are recorded in the PR owner-preview update, after source freeze. No data-writing tests target the real API.

Deployment uses production UI flag v2, current MAX username, same-origin API, immutable image SHA, shared deployment lock, and static-only recreation. Backend stays af606f9. Service worker and manifest are unchanged; HTML/SW/manifest require revalidation and hashed assets are immutable. Previous33d/e81 frontend is archived and canary-tested before switching. The existing main-only release scripts are unchanged. Generic rollback-static cannot select33d ahead ofaf6 backend: a bounded task operator independently checks API/config compatibility, source allowlist, exact image ID and protected runtime/config identity before restoring onlystatic. The deployment result, public checks, image identity and exact rollback command are recorded with the deployed SHA in PR185. PR remains Draft; owner physical acceptance is pending.
