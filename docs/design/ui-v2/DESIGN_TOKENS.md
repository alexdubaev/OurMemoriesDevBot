# Tokens and themes

Canonical typed source: `tokens/design-tokens.ts`.
Platform-neutral machine-readable export: `tokens/design-tokens.json`.
`tokenVariables(theme)` derives scoped web variables from that same object.
`write-matrix.ts` regenerates the JSON export; it also regenerates inventory as unverified NO,
so do not run it after verification without repeating the relevant gate.

| System | Choice |
|---|---|
| Color | Milk #fbf9f5, paper #fffefa, ink #30372f, secondary #626b61, line #e3e5dc |
| Spacing | 2, 4, 8, 12, 16, 24, 32, 48, 64 |
| Radii | 8 small / 12 field / 20 surface / 28 sheet / 999 pill |
| Type | 12 caption / 13 meta / 15 person / 16 body / 19 section / 26 title / 34 display |
| Weight | 400 reading / 500 names / 600 section and strong action |
| Touch | Minimum 44px, primary 48px |
| Motion | Press 100ms / fast 160ms / normal 220ms / hold 450ms |
| Safe area | Environment insets and optional host top/bottom input |
| Z | Content 0 / navigation 10 / backdrop 20 / overlay 30 / toast 40 |

| Theme | Accent | Tint | Wash |
|---|---|---|---|
| Mint | #346653 | #e5eee7 | #f1f5ef |
| Rose | #914e60 | #f5e4e8 | #fcf1f2 |
| Sky | #3d6481 | #e4edf5 | #f0f5fa |
| Lavender | #6a568c | #eee7f5 | #f6f2fa |
| Apricot | #8c5736 | #f6e8d9 | #fcf5ec |
| Sand | #776344 | #efe8db | #f7f4ee |

Theme changes accent, tint, wash and waveform detail. Layout, type, radii and spacing remain fixed.
Aspect ratios and percentages express media/layout relationships; waveform peak heights are
fixture data. Lab sidebar/frame sizes belong to tooling, not native product geometry.
