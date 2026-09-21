# Asset Rules

## Brand

Correct source assets:
- `memoly-logo-correct.png`
- `memoly-ly-mark.png`

Production candidates:
- `.webp` versions in same folder.

Do not regenerate logo.
Do not approximate logo in text/CSS.

## Functional icons

Use existing `WebpIcon` system.

Assets:
`06_ASSETS/icons/`

Repo implementation:
- `webapp/src/components/WebpIcon.tsx`
- `webapp/src/components/webp-icon-manifest.ts`

Do not replace the whole icon system with emoji.

## Decorative artwork

Theme ChildHeader art:
ImageGen raster only.

No:
- SVG illustration;
- CSS illustration;
- gradient-only substitute if approved artwork exists.

Production:
WebP.

## Optimization

Header-art web target:
- width ≈960px source;
- quality ≈78;
- preserve enough resolution for DPR2 mobile;
- no text baked into images;
- no child avatar baked into images;
- no logo baked into images.

This separation lets UI text/avatar remain real and accessible.
