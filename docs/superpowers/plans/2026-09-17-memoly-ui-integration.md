# memoLy UI Kit Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved memoLy UI Kit presentation to the existing Mini App while retaining all established frontend behaviours and backend contracts.

**Architecture:** A frontend-only `memoly-ui` presentation module provides the approved kit layout with project WebP icons and no demo runtime. Feed/family adapters render existing DTO/query data and preserve the current media primitives and callbacks; the existing controllers remain behavioural owners.

**Tech Stack:** React 19, TypeScript, Vite, TanStack Query, Bun test, Playwright, PhotoSwipe, existing project UI primitives.

**Spec:** `docs/superpowers/specs/2026-09-17-memoly-ui-integration-design.md`

## Global Constraints

- Do not change backend, Prisma, contracts, auth, FamilyAccess semantics, storage, or external-video handoff/cache.
- Do not import UI-kit demo data, demo URLs/media/assets, `alert`, or `localStorage` into production.
- Use existing `WebpIcon`; do not introduce inline SVG, SVG assets, icon fonts, or a new icon library.
- Existing feed queries/mutations, private-media access, PhotoSwipe, voice playback and both video paths remain behavioural sources of truth.
- Add Sheet exposes only `Голос или видео` to Full access and calls the existing host bot callback; photo/note presentation is exported but not in the production flow.
- Viewer cannot create, edit, or delete; capabilities come from current data rather than newly calculated client rules.

---

### Task 1: Presentation foundation and view-model adapter

**Files:**
- Create: `webapp/src/features/memoly-ui/types.ts`
- Create: `webapp/src/features/memoly-ui/adapters.ts`
- Create: `webapp/src/features/memoly-ui/memoly-ui.css`
- Create: `webapp/tests/memoly-ui-adapters.test.ts`
- Modify: `webapp/src/production.css`

**Interfaces:**
- Consumes: `MemoryDto`, family child/member/invite DTOs, `feedChildSubtitle`, and project WebP icons.
- Produces: pure adapter exports that map display-only values; components retain media render slots and existing callbacks.

- [ ] **Step 1: Write failing adapter tests**

```ts
test('maps a private-photo memory without changing its private path', () => {
  expect(toMemoryPresentation(memory)).toMatchObject({ id: memory.id, type: 'photo', images: [memory.attachments[0]!.playbackPath] })
})

test('maps owner, full, and viewer capabilities only from supplied values', () => {
  expect(toCapabilities({ role: 'viewer', isOwner: false })).toMatchObject({ canContribute: false, canDeleteMemories: false })
})
```

- [ ] **Step 2: Run the adapter test and verify expected RED failure**

Run: `bun run --cwd webapp test -- memoly-ui-adapters.test.ts`

Expected: test-file/module-not-found failure for the new presentation adapter.

- [ ] **Step 3: Implement pure display adapters and namespaced CSS foundation**

```ts
export function toMemoryPresentation(memory: MemoryDto, timezone: string): MemoryPresentation {
  return { id: memory.id, type: memory.kind, body: memory.body, dateKey: dateKey(memory.occurredAt, timezone), likes: memory.likes }
}
```

Copy only approved layout declarations from the kit into a namespaced stylesheet,
replace SVG icon positions with `WebpIcon` slots, and remove every demo asset URL.

- [ ] **Step 4: Run adapter test and typecheck to verify GREEN**

Run: `bun run --cwd webapp test -- memoly-ui-adapters.test.ts && bun run typecheck:webapp`

Expected: focused tests and webapp typecheck pass.

### Task 2: Feed shell, cards, and media-preserving presentation

**Files:**
- Create: `webapp/src/features/memoly-ui/FeedPresentation.tsx`
- Modify: `webapp/src/features/feed/FeedPage.tsx`
- Modify: `webapp/src/features/feed/components/FeedShell.tsx`
- Modify: `webapp/tests/feed.test.tsx`
- Modify: `webapp/tests/design-system.test.tsx`

**Interfaces:**
- Consumes: Task 1 adapter output; current `Attachment`, `MemoryDetail`, PhotoSwipe, `privateMediaSource`, playback registration, Telegram/MAX handoff, and feed callbacks.
- Produces: kit-faithful feed card/shell structure whose media slots are filled by the existing media primitives.

- [ ] **Step 1: Write failing presentation regression tests**

```tsx
test('renders the memoLy feed presentation while opening a two-photo PhotoSwipe album', async () => {
  renderFeedWithPrivateAlbum()
  await userEvent.click(screen.getByRole('button', { name: /открыть воспоминание/i }))
  expect(PhotoSwipeLightbox).toHaveBeenCalled()
})

test('keeps video overlay below bottom navigation', () => {
  renderTelegramVideoCard()
  expect(screen.getByTestId('bottom-navigation')).toHaveStyle({ zIndex: '30' })
})
```

- [ ] **Step 2: Run focused feed tests and verify RED**

Run: `bun run --cwd webapp test -- feed.test.tsx design-system.test.tsx`

Expected: assertions fail because memoLy presentation classes/slots do not yet exist.

- [ ] **Step 3: Implement the presentation wrapper around existing behaviour**

Keep `useFeedQuery`, query cache updates, `showPhoto`, `AudioPlayer`,
`PrivateVideo`, `TelegramVideo`, `MaxVideoPreview`, and `MemoryDetail` intact.
Move only their surrounding markup/classes to kit-faithful presentation components.
Pass the existing `onLike`, `onDelete`, load-more sentinel, and detail handlers;
do not pass raw private URLs to a new viewer.

- [ ] **Step 4: Run focused feed suite and build**

Run: `bun run --cwd webapp test -- feed.test.tsx playback.test.tsx private-media-access.test.ts && bun run build:webapp`

Expected: all selected tests and Vite build pass.

### Task 3: Bottom navigation and production Add Sheet

**Files:**
- Create: `webapp/src/features/memoly-ui/AddSheetPresentation.tsx`
- Modify: `webapp/src/components/BottomNavigation.tsx`
- Modify: `webapp/src/features/feed/FeedPage.tsx`
- Modify: `webapp/tests/design-system.test.tsx`
- Modify: `webapp/tests/navigation.test.ts`

**Interfaces:**
- Consumes: Full/viewer role supplied by the existing controller and `HostBridge.openBot`.
- Produces: kit-faithful navigation and a sheet with only the working `Голос или видео` action in current production rendering.

- [ ] **Step 1: Write failing navigation tests**

```tsx
test('shows only the voice-or-video handoff in the full-access add sheet', async () => {
  renderFullFeed()
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  expect(screen.getByRole('button', { name: /голос или видео/i })).toBeVisible()
  expect(screen.queryByText('Фото')).not.toBeInTheDocument()
})

test('does not expose an add action to a viewer', () => {
  renderViewerFeed()
  expect(screen.queryByRole('button', { name: 'Добавить' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run focused navigation tests and verify RED**

Run: `bun run --cwd webapp test -- design-system.test.tsx navigation.test.ts`

Expected: the voice-or-video-only UI assertion fails before the new sheet is wired.

- [ ] **Step 3: Implement the sheet and handoff**

Export photo/note card/form presentation components for future T09 without
rendering them. Render exactly one user-facing option labelled `Голос или видео`
for Full access and make it call the existing `hostBridge.openBot`; preserve
history/focus and viewer non-interactivity.

- [ ] **Step 4: Run focused tests and lint**

Run: `bun run --cwd webapp test -- design-system.test.tsx navigation.test.ts && bun run lint`

Expected: selected tests and lint pass.

### Task 4: Family presentation and role-bound actions

**Files:**
- Create: `webapp/src/features/memoly-ui/FamilyPresentation.tsx`
- Modify: `webapp/src/features/family/FamilyScreen.tsx`
- Modify: `webapp/tests/family-model.test.ts`
- Modify: `webapp/tests/family-onboarding-error.test.ts`
- Modify: `webapp/e2e/specs/family.spec.ts`

**Interfaces:**
- Consumes: existing `FamilyResponse`, members, invites, usage request, and callbacks that call family API functions.
- Produces: kit-faithful family sections while invoking exactly the pre-existing invite, member, child, revoke, leave, and refresh callbacks.

- [ ] **Step 1: Write failing family presentation/access tests**

```tsx
test('renders invite controls only when supplied family capability permits invite', () => {
  renderFamily({ current: viewer })
  expect(screen.queryByRole('button', { name: /пригласить/i })).not.toBeInTheDocument()
})

test('renders pending invite values without exposing a raw token', () => {
  renderFamily({ invites: [invite] })
  expect(screen.getByText(invite.inviteeDisplayName!)).toBeVisible()
  expect(screen.queryByText(invite.rawToken)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run focused family tests and verify RED**

Run: `bun run --cwd webapp test -- family-model.test.ts family-onboarding-error.test.ts`

Expected: kit-presentation assertions fail before the new screen is wired.

- [ ] **Step 3: Implement family presentation slots**

Use the current owner/full/viewer action guards and current API callback sites.
Do not introduce a second capability calculator, expose technical IDs/tokens, or
change invite acceptance/revocation semantics.

- [ ] **Step 4: Run focused family tests and browser scenario**

Run: `bun run --cwd webapp test -- family-model.test.ts family-onboarding-error.test.ts && bun run --cwd webapp e2e -- specs/family.spec.ts`

Expected: component and family Playwright tests pass.

### Task 5: Responsive regression gate and final integration verification

**Files:**
- Modify: `webapp/e2e/feed.spec.ts`
- Modify: `webapp/tests/mini-app-viewport.test.ts`
- Test: `webapp/tests/feed.test.tsx`
- Test: `webapp/tests/playback.test.tsx`
- Test: `webapp/tests/private-media-access.test.ts`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: evidence that the rendered UI preserves desktop-width bounds, mobile safe areas, and the media/navigation stacking contract.

- [ ] **Step 1: Write failing viewport and stacking assertions**

```ts
for (const width of [320, 390, 430, 480]) {
  test(`feed is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  })
}
```

- [ ] **Step 2: Run the new browser check and verify RED**

Run: `bun run --cwd webapp e2e -- feed.spec.ts`

Expected: the new selectors/assertions fail before they are added to the implementation.

- [ ] **Step 3: Add only test identifiers or CSS stacking corrections required by the failing checks**

Keep bottom navigation over card video overlays and retain fullscreen viewer
precedence. Do not alter layout tokens or introduce a redesign.

- [ ] **Step 4: Run final required checks**

Run: `bun run typecheck:webapp && bun run lint && bun run build:webapp && bun run test:webapp && bun run --cwd webapp e2e -- feed.spec.ts specs/family.spec.ts`

Expected: every command exits 0 and test output reports non-zero executed tests.
