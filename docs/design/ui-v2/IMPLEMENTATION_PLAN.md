# MEMOLY-UI-V2-REACT-LAB

Base: `329d6b9ccb7616adc6c5c75d2781db62400a5f32` (fresh origin/main, 2026-10-02).
Branch: `design/ui-v2-react-lab`. Main executor: Codex. One scoped independent reviewer at the end.

Allowed paths: `webapp/src/dev/ui-v2/**`, `webapp/ui-v2.html`,
`webapp/ui-v2.vite.config.ts`, `webapp/e2e/ui-v2/**`, `docs/design/ui-v2/**`.
All production files, manifests, dependencies, contracts, backend, auth and cache are read-only.
Existing untracked files in the primary checkout belong to earlier work; untouched.

1. Inventory actual active App composition and its imported surfaces. Register every distinct
   user-visible state with its production source; document inactive template routes separately.
2. Establish platform-neutral tokens/models and canonical primitives, FamilyHero, MemoryCard,
   BottomTabs, feedback, forms and overlays before assembling screens.
3. Assemble all screen families with fixture state transitions. Dedicated Vite HTML entry;
   no production main imports, providers, SDKs, API proxy or remote media. Each state has a clean preview URL.
4. Targeted browser checks: catalog coverage, roles/shared palette, navigation, carousel, reactions,
   form success/error/cancel, modal focus, no API, widths 320/360/390/430 and tablet.
   Run webapp typecheck/lint/build, architecture/template checks and prove production output excludes Lab.
5. Reconcile visual consistency using screenshots; independent scoped review; fix confirmed findings.
   Commit explicit paths, push authorized task branch, draft PR. No merge/deploy/integration.

Visual direction: Modern family storybook / cozy scrapbook minimal. Warm milk canvas, quiet ink,
sage base accent, one pastel accent system. System sans throughout; 400 body, 500 names, 600 headings.
Signature: a consistent album opening with official memoLy logo, child portrait and “Все семьи”
inside one FamilyHero; edge-to-edge large photographs below quiet author rows.
No separate Feed/Family hero CSS. One component geometry across profile covers; one fixed palette (latest owner decision).

Stop: unexpected origin, secret exposure, production mutation, API dependency or scope expansion.
Playback and sharing are explicit fixture simulations; no recorder or provider integration.
