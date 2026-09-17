# memoLy Feed faithful integration design

## Status and scope

- Task: T07, feed-only presentation reintegration.
- Base: `8281907a5091b57109bba4f3a733e42e042a5002`.
- Branch: `feat/memoly-ui-faithful`.
- Worktree: `D:\codex\TG_OurMemoriesDevBot\worktrees\memoly-ui-faithful`.
- Visual source of truth: `D:\codex\memoLy-react-vite-kit.zip`, especially `src/ui/MemoLyApp.tsx`, `src/ui/memoly.css`, and the supplied feed references “Фото 1” and “Фото 4”.
- Behavioral source of truth: the feed implementation at the base commit.

This phase changes only the Feed screen and its presentation-level shared primitives. It does not implement or restyle Family, onboarding, invitations, editors, T09, backend, contracts, storage, authentication, or database code.

## Architecture

`FeedPage` remains the controller for the existing query and mutation flow. It continues to own family-scoped keyset pagination, filtering, live refresh, optimistic likes and deletion, access-loss handling, selected-memory state, and media lifecycle.

A new feed presentation composition replaces the old card/layout JSX. It follows the UI Kit structure rather than adding kit classes to the old layout:

1. memoLy top bar;
2. child hero with real child identity and avatar;
3. horizontally scrollable filters;
4. date-grouped memory cards;
5. fixed three-position bottom navigation.

The presentation receives normalized props and callbacks. It does not fetch data, infer authorization, create demo state, or use localStorage.

## Mapping

| Existing production source | New presentation responsibility |
|---|---|
| `FeedPage` + `useFeedQuery` | Feed controller, loading/error/pagination and real `MemoryDto[]` |
| `MemoryDto.kind/body/occurredAt/author/likes` | Card type, copy, grouping, author row, time, like state |
| `memory.capabilities.delete` | Whether the overflow sheet exposes Delete |
| `useMemoryLike` | `onLike(memory)` callback with existing optimistic rollback |
| `useMemoryDelete` | confirmed `onDelete(memory)` callback with existing cache rollback |
| `showPrivatePhotoAlbum` | Photo card open action and PhotoSwipe lifecycle |
| `AudioPlayer` + playback coordinator | Voice card playback, real waveform/progress and single-player behavior |
| `PrivateVideo` | Private-storage HTML5 video behavior |
| Telegram video handoff | Telegram-origin video open action and single-flight guard |
| MAX video preview/handoff | Existing inline MAX playback and secondary host action |
| `FeedShell`/`BottomNavigation` | UI Kit geometry and styling with existing navigation semantics |

## Visual rules

The implementation targets at least 95% perceived fidelity to the supplied feed reference, excluding user photos and variable content. The comparison prioritizes:

- header and child-hero geometry;
- logo scale and placement;
- avatar size and decorative cluster;
- filter height, spacing and selected state;
- card dimensions, radii, shadows and density;
- photo, video, voice and note arrangements;
- typography and the navy/violet/pink/cream palette;
- like and overflow placement;
- bottom-navigation geometry and central Add button.

UI Kit CSS is the starting point. Responsive corrections may be added only to preserve the same composition at 320, 390, 430 and 480 CSS pixels, handle host insets, prevent media overlays from covering navigation, and support real variable-length data.

Existing project requirements still prohibit inline SVG and demo data. UI controls use the existing `WebpIcon` pipeline or newly generated optimized WebP RGBA assets where the kit lacks a suitable asset. Kit demo photos, audio, video, seed records, synthetic waveform fallback, and `alert()` callbacks are not production inputs.

## Behavior preservation

The new presentation must preserve:

- filter-specific query keys and cursor pagination;
- deduplication and next-page retry;
- optimistic like/unlike with rollback;
- capability-gated delete with confirmation and rollback;
- protected same-origin private media access;
- PhotoSwipe album open/close/focus/scroll behavior;
- voice play, pause, seek, measured waveform and coordinated playback;
- private video playback;
- Telegram video opaque-pointer handoff;
- current MAX inline playback and host action;
- viewer restrictions and the non-interactive center navigation state;
- feed/family navigation callbacks and normalized host safe insets.

No upload, note-creation, edit, invitation, or Family presentation is added in this phase. The Add control keeps the existing application boundary and must not fabricate T09 behavior.

## Testing approach

Behavioral changes follow test-first development. Presentation tests are added or updated before production code and must fail for the missing new composition rather than for environment setup.

Deterministic checks:

- targeted feed and design-system component tests;
- playback, private-media and waveform tests;
- `bun run test:webapp`;
- `bun run --cwd webapp e2e -- feed.spec.ts`;
- `bun run typecheck:webapp`;
- `bun run build:webapp`.

The visual gate is separate from compilation:

1. run the production frontend with representative real/fixture API responses;
2. run the original UI Kit independently;
3. capture both at 390 CSS pixels;
4. compare geometry, typography, palette, radii, shadows, spacing, nav and density;
5. record a mismatch ledger and iterate until no obvious designer-blocking mismatch remains;
6. check production at 320, 430 and 480 CSS pixels.

Functional browser checks cover filters, pagination, like/unlike, delete, PhotoSwipe, voice play/progress, private video, Telegram/MAX video, viewer restrictions, bottom navigation, and overlay/nav stacking.

## Stop conditions

- Stop if the UI Kit cannot be rendered or the representative feed cannot be run without missing secrets; report the exact blocker rather than substituting build output for visual evidence.
- Stop before any backend, contract, schema, auth, Family or T09 change.
- Stop after the Feed implementation and evidence are ready for the owner’s phone review.
- Do not push, create a PR, merge, deploy, or begin the next screen.

Final task status remains `READY FOR MANUAL FEED VISUAL ACCEPTANCE`; the agent does not accept the visual result on the owner’s behalf.
