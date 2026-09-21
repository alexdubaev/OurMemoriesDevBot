# memoLy — Production handoff: Memory actions + delete spotlight

## Do not implement this interaction in the static HTML

The static prototype is a visual source of truth only.

The production behavior must be implemented in React in `webapp/`.

---

# What exists now in the repo

## Feed

`webapp/src/features/feed/FeedPage.tsx`

Current `MemoryActions`:
- uses `DropdownMenu`
- opens a generic `AlertDialog` for delete
- owns `confirming` / `submitting` internally
- already calls the real `useMemoryDelete(...)` mutation
- already respects `memory.capabilities.delete`

Current production copy:

- `Подробнее`
- `Удалить воспоминание`
- `Удалить воспоминание?`
- `Оно исчезнет из семейной ленты.`

Do not change backend delete semantics.

## Card

`webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`

The card already has:
- `data-memory-id`
- author row
- media/content presentation
- like state
- actions slot

## Add bottom sheet

`webapp/src/features/memoly-ui/AddSheetPresentation.tsx`

Already uses Vaul `Drawer`.

This should become the basis for the shared memoLy BottomSheet shell.

---

# Desired production architecture

## 1. `MemolyBottomSheet`

Create one reusable wrapper around the existing Vaul `Drawer`.

Use it for:
- Add
- Memory actions
- Settings / Help actions

The shell owns:
- overlay blur/dim
- panel radius/material
- handle
- max width
- bottom safe-area
- close behavior
- focus return

Feature screens only provide content.

Do NOT duplicate the panel/backdrop CSS per feature.

---

## 2. Move Memory actions out of `DropdownMenu`

Replace `DropdownMenu` in `MemoryActions` with the shared `MemolyBottomSheet`.

State in `FeedPage`:

```ts
const [actionsMemory, setActionsMemory] = useState<MemoryDto | null>(null)
const [deleteTarget, setDeleteTarget] = useState<MemoryDto | null>(null)
```

Flow:

```text
tap "..."
    ↓
actionsMemory = memory
    ↓
MemolyBottomSheet opens
    ↓
Подробнее → setDetail(memory), close actions sheet
Удалить    → close actions sheet, setDeleteTarget(memory)
```

Viewer / permissions:
- `Подробнее` always exists
- `Удалить воспоминание` only if `memory.capabilities.delete === true`

Do not infer permission from role in the UI. Use `capabilities.delete`.

---

# 3. `MemoryDeleteSpotlight`

This is NOT a BottomSheet.

It is a controlled modal overlay rendered through a React portal / Radix AlertDialog primitive.

Props:

```ts
type MemoryDeleteSpotlightProps = {
  memory: MemoryDto | null
  open: boolean
  submitting: boolean
  error?: string | null
  preview: ReactNode
  onCancel: () => void
  onConfirm: () => void
}
```

Visual behavior:

1. Full viewport overlay.
2. Rest of the application:
   - dim
   - `backdrop-filter: blur(10px)`
3. Selected memory:
   - sharp
   - centered
   - max width ~420px / 92vw
   - max height ~60–64dvh
4. Confirmation panel directly below the selected memory:
   - `Удалить это воспоминание?`
   - `Оно исчезнет из семейной ленты.`
   - `Отмена`
   - `Удалить`
5. No generic modal detached from the selected object.

The selected memory itself is the destructive-action context.

---

# 4. Do not clone DOM nodes

Do NOT use:

```ts
element.cloneNode(true)
```

Do NOT move the original DOM card into a portal.

React must render the preview declaratively.

Preferred approach:

```tsx
<MemoryDeleteSpotlight
  memory={deleteTarget}
  open={deleteTarget !== null}
  preview={deleteTarget ? renderDeletePreview(deleteTarget) : null}
  ...
/>
```

This keeps state predictable and works across MAX / Telegram / normal browsers.

---

# 5. Preview implementation

The spotlight preview should look like the Feed memory card, but be non-interactive.

Recommended implementation:

Add a presentation mode to `MemoryCardPresentation`:

```ts
type MemoryCardPresentationProps = {
  ...
  mode?: 'feed' | 'delete-preview'
}
```

In `delete-preview` mode:

- no `...` actions
- no clickable Like
- no comments actions
- no open buttons
- no media controls
- visual content remains the same
- wrap preview with `aria-hidden="true"`
- `pointer-events: none`

Do not fork a second unrelated card design.

If rendering full video/audio twice causes media side effects, make the preview media static:

- photo → preview/display image
- private video → preview rendition / poster
- Telegram video → `thumbnailPath`
- MAX video → neutral video poster state if no thumbnail is available
- voice → waveform snapshot, no playback

The preview does not need to be playable.

---

# 6. FeedPage state ownership

Deletion state belongs in `FeedPage`, not inside the action menu.

Suggested state:

```ts
const [actionsMemory, setActionsMemory] = useState<MemoryDto | null>(null)
const [deleteTarget, setDeleteTarget] = useState<MemoryDto | null>(null)
const [deleteError, setDeleteError] = useState<string | null>(null)
```

Delete request:

```ts
const confirmDelete = async () => {
  if (!deleteTarget || deletion.isPending) return

  setDeleteError(null)

  try {
    await deletion.mutateAsync({
      memoryId: deleteTarget.id,
      version: deleteTarget.version,
    })
    setDeleteTarget(null)
  } catch {
    setDeleteError('Не удалось удалить воспоминание. Попробуйте ещё раз.')
  }
}
```

Important:

- Keep spotlight open while mutation is pending.
- Disable both destructive double-submit and dismiss while submitting.
- On mutation error, KEEP the memory visible and sharp.
- Show error inside the confirmation panel.
- On success, React Query / mutation update removes the card naturally.
- Do not manually delete DOM elements.

---

# 7. Original card while spotlight is open

To avoid seeing the same memory twice through the blurred background:

pass:

```tsx
deleteTargetId={deleteTarget?.id ?? null}
```

or compute:

```tsx
const isDeleteTarget = deleteTarget?.id === memory.id
```

Add to `MemoryCardPresentation`:

```tsx
<article
  aria-hidden={isDeleteTarget || undefined}
  className={cn(
    'memoly-memory ...',
    isDeleteTarget && 'memoly-memory-delete-source'
  )}
>
```

CSS:

```css
.memoly-memory-delete-source {
  visibility: hidden;
}
```

This preserves layout height, so the feed does not jump underneath the overlay.

Do NOT use `display: none` while the confirmation is open.

---

# 8. Optional center transition

Do not make animation a prerequisite for the feature.

Phase 1:
- fade/scale preview into center
- source card becomes `visibility:hidden`

This is robust.

Optional later:
- capture source card `getBoundingClientRect()`
- animate preview from source rect to centered rect (FLIP)

Do not introduce View Transition API as a hard dependency; embedded WebViews may vary.

---

# 9. Accessibility

Use dialog semantics.

Requirements:

- modal focus trap
- title associated with dialog
- description associated with dialog
- `Escape` / host Back cancels only when not submitting
- restore focus to the `...` action trigger after cancel
- preview itself is visual context and non-interactive
- destructive button has visible danger state

Suggested primitive:
- Radix `AlertDialog` primitive already exists in the repo.

Feature-specific content may import the primitive directly or the shared UI wrapper may be extended.

---

# 10. BottomSheet consolidation

Current code has:
- AddSheet → Vaul Drawer
- MemoryActions → DropdownMenu
- settings later / separate UI

Target:

```text
MemolyBottomSheet
├─ AddActionsContent
├─ MemoryActionsContent
└─ SettingsActionsContent
```

Do not convert the delete spotlight into a sheet.
Spotlight is a separate confirmation pattern.

---

# Files expected to change

Primary:

- `webapp/src/features/feed/FeedPage.tsx`
- `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`
- `webapp/src/features/feed/presentation/memoly-feed.css`
- `webapp/src/features/memoly-ui/AddSheetPresentation.tsx`

New:

- `webapp/src/features/memoly-ui/MemolyBottomSheet.tsx`
- `webapp/src/features/feed/MemoryDeleteSpotlight.tsx`

Potential:
- a small static-media preview helper for video/voice

---

# Tests required

## Unit / component

1. FULL/capability true:
   - actions sheet contains Delete
2. capability false:
   - Delete is absent
3. click Delete:
   - actions sheet closes
   - spotlight opens for exact memory
4. source card:
   - remains in layout
   - is visually hidden
5. Cancel:
   - spotlight closes
   - source card reappears
   - focus returns to action trigger
6. Confirm:
   - calls mutation with exact `id` + `version`
   - button is disabled while pending
7. Success:
   - spotlight closes after mutation resolves
8. Failure:
   - spotlight remains open
   - card remains visible in spotlight
   - inline error appears
9. rapid double click:
   - only one delete request

## E2E

Add a Playwright flow to `webapp/e2e/feed.spec.ts`:

```text
open actions
→ choose Delete
→ selected memory appears in spotlight
→ background is modal
→ cancel
→ source memory still exists
→ repeat
→ confirm
→ memory disappears
```

Do not validate only by screenshot. Validate selected `memory.id`.

---

# Acceptance criteria

The feature is complete only when:

- the exact selected memory stays visually attached to delete confirmation
- no DOM cloning is used
- no hash-driven interaction is used
- delete permission comes from `capabilities.delete`
- existing `useMemoryDelete` is reused
- error handling keeps the confirmation open
- action UI and Add UI share the same BottomSheet shell
- static HTML remains a visual reference only
