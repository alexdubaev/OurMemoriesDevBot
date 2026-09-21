# Repository Implementation Map

Repo snapshot:
`OurMemoriesDevBot-main`

## Feed controller
`webapp/src/features/feed/FeedPage.tsx`

Owns:
- feed query;
- pagination;
- like mutation;
- delete mutation;
- media attachment rendering;
- memory detail;
- AddSheet state.

Target change:
- move memory action/delete state to FeedPage;
- shared BottomSheet;
- spotlight delete.

## Current MemoryActions
Inside `FeedPage.tsx`.

Current:
- DropdownMenu;
- AlertDialog.

Target:
- MemolyBottomSheet for actions;
- MemoryDeleteSpotlight for confirmation.

## Feed presentation
`webapp/src/features/feed/presentation/FeedPresentation.tsx`

Current issue:
- gear/help button still exists in Feed presentation API.

Accepted UI:
- no settings button in Feed ChildHeader.

Target:
- align with shared ChildHeader contract.

## Memory card
`webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`

Target:
- keep single visual component;
- add delete-preview mode;
- source hidden with visibility during delete confirm.

## Bottom navigation
`webapp/src/components/BottomNavigation.tsx`

Already shared.
Keep one component.

Retheme/reskin to accepted version, do not fork.

## Add sheet
`webapp/src/features/memoly-ui/AddSheetPresentation.tsx`

Uses Vaul Drawer.

Use this primitive to build shared `MemolyBottomSheet`.

## Family
`webapp/src/features/memoly-ui/FamilyPresentation.tsx`

Target:
- shared ChildHeader;
- Family settings button;
- settings/appearance/help as accepted design;
- preserve existing family management behavior.

## Old Appearance
`webapp/src/features/settings/AppearancePanel.tsx`

This is generic dashboard light/dark/system.

Do not use it as memoLy theme selector.

## Icons
- `webapp/src/components/WebpIcon.tsx`
- `webapp/src/components/webp-icon-manifest.ts`
- `webapp/public/assets/icons/`

Keep this system.

## Contracts
`packages/contracts/src/memories.ts`

Memory capabilities:
- edit
- delete
- like

Use capabilities as authority.

## Media
Keep:
- `webapp/src/features/feed/playback.tsx`
- `webapp/src/features/feed/playback-context.ts`
- `webapp/src/features/feed/telegram-video-handoff.ts`
- `webapp/src/platform/media/private-media-access.ts`
- MAX media source logic in FeedPage.

Do not replace media architecture as part of UI migration.
