# memoLy UI Kit integration design

## Goal

Make the approved memoLy React/Vite kit the presentation layer of the existing
Mini App without changing backend/API contracts or replacing established media,
authentication, pagination, or authorization behavior.

## Architecture

The integration introduces a frontend-only presentation module and an adapter
layer. The adapter maps existing `MemoryDto`, family responses, and existing
role/capability values into UI-kit-shaped view models; it never creates a new
source of truth or persists state. The existing feed and family controllers
continue owning queries, mutations, pagination, media sources, PhotoSwipe, and
host handoffs. Presentation components receive those behaviours through typed
slots/callbacks rather than substituting the kit's demo viewer/player.

## Data and permissions

`FeedPage` continues to call `useFeedQuery`, `useMemoryLike`, and
`useMemoryDelete`. It provides mapped display fields and the existing action
callbacks to presentation cards. A card keeps the current private photo,
voice, Telegram-video, and MAX-video primitives mounted inside the kit visual
structure. `FamilyScreen` remains the only UI caller of family-management API
methods; its existing owner/full/viewer decisions are mapped to presentation
capabilities and are not reimplemented from route or client state.

## Presentation assets and icons

Only the kit's layout/CSS and component structure may be adopted. No
`src/demo`, demo handlers, `alert`, `localStorage`, demo URLs, or demo media
assets enter production. The kit's inline SVG icons are replaced by existing
project `WebpIcon` instances. Existing product brand assets remain the only
runtime assets.

## Add Sheet

The production navigation exposes one Full-access action: `Голос или видео`.
It calls the existing host bridge bot handoff. Photo and note presentation
components remain exported but are not rendered or callable until T09 provides
real create flows. VIEWER retains the existing non-interactive viewing state.

## Non-negotiable behavior

- Preserve Telegram authentication, session handling, family isolation, and
  OWNER/FULL/VIEWER server-backed semantics.
- Preserve protected media URL/session handling, PhotoSwipe, Range/206 voice,
  HTMLMediaElement lifecycle and both Telegram/MAX video paths.
- Preserve infinite-feed pagination, refresh behaviour, optimistic likes,
  delete confirmation and rollback.
- Keep the bottom navigation above video overlays at every supported mobile
  viewport; viewer/fullscreen layers may deliberately cover it.
- Do not modify backend, Prisma, contracts, storage pipelines, or external
  video handoff/cache.

## Verification

Each presentation boundary receives a failing focused test before its code is
implemented. The final gate runs webapp typecheck, lint, build, relevant unit
tests, mobile checks at 320/390/430/480 CSS pixels, and the video-overlay
stacking assertion.
