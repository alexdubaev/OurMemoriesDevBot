# Acceptance Checklist

## Visual foundations
- [ ] tactile raised/inset material matches reference
- [ ] no generic flat-card substitution
- [ ] no decorative clutter outside app UI
- [ ] no fake statusbar

## ChildHeader
- [ ] same logo/avatar/name/age coordinates Feed ↔ Family
- [ ] Feed has no settings
- [ ] Family settings is overlay
- [ ] theme image changes without layout shift

## BottomNav
- [ ] one component
- [ ] same geometry all sections
- [ ] active state themed
- [ ] Add respects role
- [ ] safe-area correct
- [ ] last feed content can scroll above nav

## BottomSheet
- [ ] same overlay/panel/handle for Add/Settings/Memory Actions
- [ ] no nested duplicate panel
- [ ] focus return works
- [ ] back closes

## Feed card
- [ ] action target ≥44px
- [ ] like micro-accent follows theme
- [ ] comments micro-accent follows theme
- [ ] portrait mobile media
- [ ] captions readable
- [ ] no horizontal overflow

## Permissions
- [ ] Delete uses `capabilities.delete`
- [ ] Viewer sees no delete
- [ ] Viewer has no Add
- [ ] no UI role guessing when capability exists

## Delete spotlight
- [ ] exact selected memory preview
- [ ] background blur/dim
- [ ] source uses `visibility:hidden`
- [ ] Cancel restores source + focus
- [ ] Confirm calls existing mutation id+version
- [ ] pending prevents duplicate request
- [ ] failure keeps spotlight open
- [ ] success closes after mutation resolves

## Media
- [ ] PhotoSwipe preserved
- [ ] Telegram handoff preserved
- [ ] MAX playback preserved
- [ ] voice waveform/playback preserved
- [ ] no new custom video player

## Theme
- [ ] Mint
- [ ] Rose
- [ ] Sky
- [ ] Lavender
- [ ] Apricot
- [ ] Sand
- [ ] all macro accents update
- [ ] all micro accents update
- [ ] correct WebP header artwork updates
- [ ] theme not tied to gender

## Asset rules
- [ ] correct memoLy logo
- [ ] Ly mark only from supplied asset
- [ ] functional icons use WebpIcon
- [ ] decorative scenes use ImageGen WebP, not SVG/CSS art

## Width QA
- [ ] 320
- [ ] 390
- [ ] 430
- [ ] 480

## Host QA
- [ ] normal browser
- [ ] Telegram webview where applicable
- [ ] MAX host where applicable
