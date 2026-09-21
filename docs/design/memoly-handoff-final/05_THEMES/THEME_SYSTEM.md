# Theme System

## Theme enum

```ts
export type MemolyTheme =
  | 'mint'
  | 'rose'
  | 'sky'
  | 'lavender'
  | 'apricot'
  | 'sand'
```

## Semantic tokens

Required:
- canvas
- canvasTop
- canvasBottom
- surface
- surfaceHi
- surfaceLo
- insetHi
- insetLo
- sheet
- accentHi
- accent
- accentMid
- accentDeep
- accentText
- accentSoft
- shadow
- shadowSoft
- glow
- headerArtUrl

## Theme palette values

See:
`theme-tokens.json`

## Artwork

Production assets:
`06_ASSETS/theme-header/web/*.webp`

Original ImageGen:
`06_ASSETS/theme-header/original/*.png`

Do not recreate these scenes as SVG/CSS.

## Header crop

Artwork is a decorative absolute layer:
```css
object-fit: cover;
object-position: center;
pointer-events: none;
```

Text/avatar remain separate real UI.

## Persisting theme

MVP:
- local preference.

Do not use child gender.

## Existing repo AppearancePanel

`webapp/src/features/settings/AppearancePanel.tsx` is old generic dashboard `system/light/dark`.

Do not use it as memoLy appearance UI.

memoLy needs its own palette selector.
