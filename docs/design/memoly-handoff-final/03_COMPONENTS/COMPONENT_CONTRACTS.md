# Component Contracts

## 1. `ChildHeader`

Props:
```ts
type ChildHeaderProps = {
  childName: string
  childSubtitle: string
  childAvatarUrl?: string | null
  childAvatarCrop?: Crop | null
  theme: MemolyTheme
  mode: 'feed' | 'family'
  onOpenChild?: () => void
  onOpenSettings?: () => void
}
```

Rules:
- same base geometry across modes;
- family-only controls are overlays/extensions;
- theme-art decorative only.

---

## 2. `BottomNavigation`

Current repo component already exists:
`webapp/src/components/BottomNavigation.tsx`

Do not fork.

Props remain conceptually:
- active;
- role;
- onFeed;
- onAdd;
- onFamily.

Target visual skin = accepted Family version.

---

## 3. `MemolyBottomSheet`

One Vaul-based wrapper.

Use for:
- Add;
- Memory Actions;
- Settings.

Owns:
- overlay;
- blur;
- panel;
- handle;
- focus return;
- safe-area;
- dismiss.

Feature owns content.

Reference:
`07_REACT_REFERENCE/MemolyBottomSheet.reference.tsx`

---

## 4. `MemoryActionsContent`

Props:
```ts
type MemoryActionsContentProps = {
  memory: MemoryDto
  onDetails: () => void
  onDelete?: () => void
}
```

Render:
- Details;
- Delete only if capability true.

No mutation/dialog state here.

---

## 5. `MemoryDeleteSpotlight`

Controlled component.

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

Not a BottomSheet.

Reference:
`07_REACT_REFERENCE/MemoryDeleteSpotlight.reference.tsx`

---

## 6. `MemoryCardPresentation`

Add:
```ts
mode?: 'feed' | 'delete-preview'
isDeleteSource?: boolean
```

### feed
interactive.

### delete-preview
non-interactive:
- no more;
- no like click;
- no comments click;
- no media playback.

`isDeleteSource`:
- class -> `visibility:hidden`;
- keeps feed geometry.

Do not create a second unrelated memory-card visual.

---

## 7. `ThemeProvider` / Theme preference

Suggested:
```ts
type MemolyTheme =
  | 'mint'
  | 'rose'
  | 'sky'
  | 'lavender'
  | 'apricot'
  | 'sand'
```

Apply on app root:
```tsx
<div data-memoly-theme={theme}>...</div>
```

Persist:
- local storage initially;
- account preference later if product decides.

Do not piggyback on old `next-themes` light/dark dashboard setting.

---

## 8. `SettingsSheet`

Uses `MemolyBottomSheet`.

Rows:
- Appearance
- Help & Privacy
- About memoLy

---

## 9. `AddSheet`

Keep existing behavior/media flow.

Replace shell styling with shared `MemolyBottomSheet` if necessary.

Content:
- Photo
- Note
- Voice or Video

No recording.

---

## 10. `PageHeader`

Internal pages:
- Back
- centered title
- optional right action

One component/skin.

Do not redraw per feature.

---

## 11. Surface primitives

Prefer:
- RaisedSurface
- InsetSurface
- RoundIconButton
- PrimaryButton
- SecondaryButton
- DangerButton

before feature-specific shadow CSS.
