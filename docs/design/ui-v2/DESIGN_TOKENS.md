# Tokens and fixed palette

Canonical typed source: tokens/design-tokens.ts; JSON export: tokens/design-tokens.json.
tokenVariables derives web variables from this same source. The historical mint identifier
now means the sole shared palette, not a selectable color theme.

| System | Choice |
|---|---|
| Color | Canvas #f7f2eb, paper #fffcf7, ink #504e49, secondary #706e67, line #ebe6de |
| Accent | #486d5e; tint #e5ede5; wash #f2f5ee; detail #a1b6a3 |
| Spacing | 2, 4, 8, 12, 16, 24, 32, 48, 64 |
| Radii | 8 small / 12 field / 24 surface and sheet / 999 pill |
| Type | 12 caption / 13 meta / 15 person / 16 body / 19 section / 26 title / 28 display |
| Weight | 400 reading / 500 names / 600 headings and actions |
| Touch | Minimum 44px, primary 48px |
| Motion | Press 100ms / fast 160ms / normal 220ms / hold 450ms |
| Safe area | Environment insets and optional host top/bottom inputs |
| Z | Content 0 / navigation 10 / backdrop 20 / overlay 30 / toast 40 |

One palette across all covers. Artwork changes only FamilyHeroModel.cover.
Layout: 84px child avatar, 82px navigation, 12px Feed inset, 300px portrait preview cap.
Wide browser content is capped at 560px. Waveform peaks are fixture data.
write-matrix.ts resets matrix rows to NO; do not run after verification without re-verifying.
