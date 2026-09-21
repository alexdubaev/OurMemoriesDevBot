# Agent task — implement production Memory Delete Spotlight

Use the current repository code, not the static HTML, as the implementation target.

Read first:

- `memoly-agent-handoff-delete-spotlight.md`
- `MemoryDeleteSpotlight.reference.tsx`
- `MemolyBottomSheet.reference.tsx`

Then inspect:

- `webapp/src/features/feed/FeedPage.tsx`
- `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`
- `webapp/src/features/feed/presentation/memoly-feed.css`
- `webapp/src/features/memoly-ui/AddSheetPresentation.tsx`
- existing feed/e2e tests

## Required outcome

1. Replace Feed memory action `DropdownMenu` with the shared memoLy BottomSheet shell.
2. Keep `Подробнее`.
3. Render Delete only from `memory.capabilities.delete`.
4. Selecting Delete opens `MemoryDeleteSpotlight`.
5. Spotlight shows the exact selected memory sharply in the center.
6. Everything else is blurred/dimmed.
7. The original source card uses `visibility:hidden`, not `display:none`, while confirm is open.
8. Cancel restores the source card and focus.
9. Confirm reuses existing `useMemoryDelete`.
10. Pending state prevents double-submit and blocks accidental dismiss.
11. Failure keeps spotlight open and shows the existing Russian error copy.
12. Success closes spotlight after the mutation resolves.
13. Do not clone or move DOM nodes.
14. Do not use URL hashes.
15. Do not use child gender for any visual behavior.
16. Preserve all current MAX / Telegram / private media behavior.

## Architecture requirement

Create/reuse:

- `MemolyBottomSheet`
- `MemoryDeleteSpotlight`

Deletion state is owned by `FeedPage`.

Do not put mutation/dialog state back inside `MemoryActions`.

## Testing

Add component/unit coverage and Playwright coverage for:
- permission visibility
- open/cancel
- correct target memory id
- successful delete
- failed delete
- double-submit protection
- focus restoration

Run:
- typecheck
- feed tests
- relevant e2e tests
- build contracts

Do not simplify the accepted memoLy visual language while implementing the flow.
