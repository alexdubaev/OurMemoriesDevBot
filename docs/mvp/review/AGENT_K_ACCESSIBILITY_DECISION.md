# Agent K: contrast decision packet

Source: frozen `docs/memoly-final-functional-state-pack.html` (SHA-256 `180F8C9B6E60369513CFFD5EB9DBB3CB3397649407DF996DCF907AB0FA38C5B4`). Axe-core 4.13.0 scanned production Feed, Family, child profile, Add, Settings, theme choice, and family settings form at 390 px in all six themes (42 states). All 42 states cleared every rule except `color-contrast`. The four remaining Family elements recur behind Settings and theme choice, yielding 72 reported nodes from 24 distinct theme/element combinations. The 28-case K fixture suite separately scanned four feed/sheet states in six themes; 162 muted/nav text nodes remain below 4.5:1 there. It also checks 200% root text, page overflow, keyboard opening, focus containment, Escape, and focus return at widths 320, 390, 430, and 480 px. These automated checks are not a claim of full manual WCAG acceptance.

The older design-system fixture filter had a separate implementation mismatch: white text on a strong accent. It now follows the canonical dark text on a light, pressed gradient. Axe finds no filter contrast violation in the 24 fixture states. The production filter already used the canonical treatment. The remaining combinations are normal text (11–16 px, reported weight normal by axe), so the WCAG AA threshold is 4.5:1 throughout.

## Production Family combinations

All four elements use normal-text contrast criteria, including the 14 px bold label. The background and accent tokens follow the frozen canonical theme family. React's `--theme-text-muted` is its port of the canonical subdued text treatment; changing these combinations to reach 4.5:1 requires a visual-contract decision.

| Theme | Muted on inset (`.family-child-quote`, `.family-info-card`) | Accent on soft (`.family-role`) | Accent on inset (`.family-info-card strong`) |
| --- | ---: | ---: | ---: |
| Mint | 3.63 (`#6f7f78` / `#ecefe9`) | 2.87 (`#698e7b` / `#dce7df`) | 3.14 (`#698e7b` / `#ecefe9`) |
| Rose | 3.86 (`#876f72` / `#f2e9e5`) | 3.05 (`#a96f79` / `#f0dcdd`) | 3.35 (`#a96f79` / `#f2e9e5`) |
| Sky | 3.73 (`#6b7f89` / `#edf3f5`) | 3.04 (`#67879a` / `#dbe8ee`) | 3.40 (`#67879a` / `#edf3f5`) |
| Lavender | 3.80 (`#7b7488` / `#f0ebf2`) | 3.15 (`#837798` / `#e4deec`) | 3.53 (`#837798` / `#f0ebf2`) |
| Apricot | 3.62 (`#8a766a` / `#f4eade`) | 2.94 (`#ad745d` / `#f1ddd0`) | 3.25 (`#ad745d` / `#f4eade`) |
| Sand | 3.75 (`#777a69` / `#efede5`) | 3.18 (`#778263` / `#e2e5d7`) | 3.47 (`#778263` / `#efede5`) |

The quote is 15 px regular, the information card copy 13 px regular, the role badge 11 px regular, and the information card label 14 px bold. All require 4.5:1. The same four Family nodes appear in the axe result for Settings and theme choice because the Family page remains rendered beneath those sheets.

## Design-system fixture combinations

| Theme | Muted text on canvas | Muted text on surface / inactive nav | Active nav accent on surface | Light text on accent action |
| --- | ---: | ---: | ---: | ---: |
| Mint | 3.68 | 3.85 | 2.64 | 2.64 |
| Rose | 4.04 | 4.12–4.19 | 3.15–3.19 | 3.23 |
| Sky | 3.76 | 3.92 | 3.07–3.14 | 3.14 |
| Lavender | 3.95 | 4.07–4.13 | 3.16–3.27 | 3.27 |
| Apricot | 3.80 | 3.98–4.00 | 2.81–2.82 | 2.81 |
| Sand | 3.82 | 4.06–4.08 | 3.12–3.15 | 3.15 |

The table below gives the measured foreground/background for one instance of each distinct semantic combination. The nav colors may differ by 1–4 RGB levels between fixture states because of their existing color mix; the ratio ranges above include those instances. Every entry is normal text with a 4.5:1 requirement: canvas copy is 15–16 px, metadata is 12 px, nav is 11 px, and the action is 15 px; axe reported normal weight for each.

| Theme | Muted / canvas | Muted / surface | Active nav / surface | Action text / accent |
| --- | --- | --- | --- | --- |
| Mint | `#6f7f78` / `#edf1ea` | `#6f7f78` / `#f5f5ef` | `#7f9f90` / `#f5f5ef` | `#f5f5ef` / `#7f9f90` |
| Rose | `#876f72` / `#f4efec` | `#876f72` / `#f8f3ef` | `#af7c83` / `#f8f3ef` | `#f8f3ef` / `#b67680` |
| Sky | `#6b7f89` / `#eef4f7` | `#6b7f89` / `#f6f8f7` | `#7293a2` / `#f6f8f7` | `#f6f8f6` / `#7092a3` |
| Lavender | `#7b7488` / `#f2f0f5` | `#7b7488` / `#f8f5f3` | `#8c87a3` / `#f8f5f3` | `#f8f5f3` / `#8e83a6` |
| Apricot | `#8a766a` / `#f6f0e8` | `#8a766a` / `#faf6f0` | `#b88a6f` / `#faf6f0` | `#faf6f0` / `#be886c` |
| Sand | `#777a69` / `#f1efe7` | `#777a69` / `#f8f6f0` | `#839379` / `#f8f6f0` | `#f8f6f0` / `#858f71` |

- **Muted on canvas:** child header subtitle and empty state copy (`--theme-text-muted` on `--theme-canvas`), 10 nodes per theme across four states. For mint, axe measured `#6f7f78` on `#edf1ea`, 15–16 px. The canonical also uses subdued copy on the themed canvas.
- **Muted on surface / inactive nav:** memory metadata and inactive nav labels (`--theme-text-muted` or the nav semantic mix on `--theme-surface`), 12 nodes per theme. For mint, axe measured `#6f7f78` on `#f5f5ef`, 11–12 px. The canonical uses similarly subdued labels and metadata.
- **Active nav accent:** `--theme-accent-deep` or a rendered accent mix on the surface, four nodes per theme. Mint measures `#7f9f90` on `#f5f5ef`, 11 px. The canonical assigns themed accent text to the active nav; changing that semantic contrast requires a visual decision.
- **Light text on accent action:** empty state primary bot action, one node per theme. Mint measures `#f5f5ef` on `#7f9f90`, 15 px. The canonical uses light text over themed accent actions.

The counts above are per-theme across the four states; the same shared components recur. Exact gradient pixels vary slightly between states, so the table reports measured ranges. The source log is held outside Git in Agent K's local test evidence.

**Owner decision required:**

A. Keep exact frozen canonical visual fidelity and accept the documented contrast violations.

B. Authorize a production accessibility color override (and define how the canonical reference is updated), targeting at least 4.5:1 for these normal-text combinations.

Agent K has not selected either direction or changed the frozen canonical palette.
