# MASTER PROMPT FOR IMPLEMENTATION AGENT

You are implementing the accepted memoLy UI in the existing repository.

## Read before coding

1. `00_START_HERE/README_FIRST.md`
2. `00_START_HERE/LOCKED_DECISIONS.md`
3. `01_TZ/MASTER_TZ.md`
4. `02_DESIGN_SYSTEM/DESIGN_SYSTEM.md`
5. `03_COMPONENTS/COMPONENT_CONTRACTS.md`
6. `04_INTERACTIONS/INTERACTION_SPEC.md`
7. `05_THEMES/THEME_SYSTEM.md`
8. `08_REPO_MAP/IMPLEMENTATION_MAP.md`
9. `08_REPO_MAP/MIGRATION_PLAN.md`
10. `09_QA/ACCEPTANCE_CHECKLIST.md`

Use:
`11_VISUAL_REFERENCE/memoly-visual-reference.html`
only as the visual source of truth.

Use the repository implementation as the behavioral/data source of truth.

## Hard constraints

- Do not redesign.
- Do not simplify tactile/neumorphic material.
- Do not add fake iOS status bar.
- Do not fork BottomNav.
- Do not fork BottomSheet.
- Do not move ChildHeader identity geometry between Feed and Family.
- Feed has no settings button.
- Family has settings.
- Do not build new video player.
- Do not add in-app video/voice recording.
- Do not tie theme to child gender.
- Do not recreate ImageGen theme artwork as SVG/CSS.
- Use supplied correct logo.
- Keep existing WebpIcon system.
- Keep existing MAX/Telegram/private media behavior.
- Use API capabilities, not guessed role rules.

## Required architecture

Create/reuse:
- `ChildHeader`
- `MemolyBottomSheet`
- `MemoryDeleteSpotlight`
- existing `BottomNavigation`
- existing `MemoryCardPresentation` with preview mode
- memoLy theme preference system

## Memory delete

State belongs in FeedPage.

No:
- `cloneNode`
- DOM movement
- hash state
- manual removal from DOM

Use existing delete mutation.

## Deliver incrementally

After each phase:
- typecheck
- tests
- visual QA at mobile widths

Do not continue if existing behavior regresses.

## Completion report

Return:
- files changed
- tests run
- visual differences from reference, if any
- known limitations
- screenshots at 390px for Feed/Family/Settings/Delete spotlight
