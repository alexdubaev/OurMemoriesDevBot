# memoLy Feed Faithful Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace only the production Feed presentation with a composition that matches the approved memoLy UI Kit and supplied feed reference at least 95% perceptually while preserving all existing feed and media behavior.

**Architecture:** Keep `FeedPage` as the controller for queries, mutations, pagination, access loss, and media lifecycle. Add a dedicated presentation package that owns the UI Kit-derived shell and card chrome, then render the existing protected media implementations through explicit presentation slots. Scope UI Kit styles beneath a feed root so Family and T09 remain unchanged.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Tailwind 4 plus scoped CSS, TanStack Query, PhotoSwipe 5, Bun tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-memoly-feed-faithful-design.md`

## Global Constraints

- Work only in `D:\codex\TG_OurMemoriesDevBot\worktrees\memoly-ui-faithful` on `feat/memoly-ui-faithful`.
- BASE is `8281907a5091b57109bba4f3a733e42e042a5002`; the design-only commit is `f5ff3fe`.
- Visual source is `D:\codex\memoLy-react-vite-kit.zip` plus “Фото 1” for the feed and “Фото 4” for the Add-overlay context.
- Do not reuse code or styling from commit `519475d133a26913583eb0d0cfddf2f457d6161c`.
- Do not modify backend, contracts, schema, auth, Family presentation, invitations, onboarding, T09, lockfiles, or dependencies.
- Do not copy kit demo data, demo handlers, demo audio/video/photos, random waveform fallback, or inline SVG icons.
- Preserve private media, PhotoSwipe, voice waveform/seek, private video, Telegram/MAX video paths, pagination, likes, delete, and viewer restrictions.
- Use existing WebP icons and `BrandLogo`; copy only the approved decorative cloud/star asset if it is required for the feed hero.
- Run each new behavior test before implementation and confirm the expected RED failure.
- Do not push, open a PR, merge, deploy, or continue beyond Feed.

## File Structure

- Create `webapp/src/features/feed/presentation/FeedPresentation.tsx`: UI Kit-derived top bar, child hero, filters, content rail, loading/error/empty slots, and feed-scoped navigation composition.
- Create `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`: author row, overflow position, media/text layouts for photo/video/voice/note, caption, like control, and date grouping chrome.
- Create `webapp/src/features/feed/presentation/memoly-feed.css`: all memoLy feed-only tokens, responsive geometry, card styles, overlays, and bottom-nav appearance under `[data-memoly-feed]`.
- Create `webapp/src/features/feed/presentation/index.ts`: public presentation exports only.
- Modify `webapp/src/features/feed/FeedPage.tsx`: retain controller/media logic, replace old layout/card JSX with presentation components and render slots.
- Modify `webapp/src/components/BottomNavigation.tsx`: add an explicit `appearance="memoly"` mode without changing the default Family appearance or behavior.
- Modify `webapp/src/features/feed/components/index.ts`: stop exporting the old FeedShell to production and expose only still-used primitives.
- Modify `webapp/src/features/feed/api.ts` and `webapp/src/features/feed/queries.ts`: import `FeedFilter` from the new presentation package.
- Modify `webapp/src/features/feed/index.ts`: export `FeedFilter` from the new presentation package while preserving the public barrel used by `App.tsx`.
- Delete `webapp/src/features/feed/components/FeedShell.tsx` after no production or test imports remain.
- Modify `webapp/tests/design-system.test.tsx`: cover feed presentation structure and memoLy navigation semantics.
- Modify `webapp/tests/feed.test.tsx`: cover card mapping, permissions, real media slots, overlays, and no demo fallback.
- Modify `webapp/e2e/feed.spec.ts`: preserve existing scenarios and add stable selectors/assertions for filters, card layout, viewer restrictions, and overlay/nav stacking.
- Add `webapp/public/assets/brand/memoly-cloud-stars.webp` from the approved UI Kit and record the corresponding runtime asset in `assets/manifest.json`.
- Promote the already-present root `heart`, `heart-filled`, and `video` WebP icon variants into `webapp/public/assets/icons/`, extend `webapp/src/components/webp-icon-types.ts`, and add new optimized `gear` and `star` WebP icon variants plus manifest entries when no approved equivalent exists.
- Store screenshots and mismatch notes outside Git at `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\`.

---

### Task 1: Build the memoLy Feed shell with test-first structure

**Files:**
- Create: `webapp/src/features/feed/presentation/FeedPresentation.tsx`
- Create: `webapp/src/features/feed/presentation/memoly-feed.css`
- Create: `webapp/src/features/feed/presentation/index.ts`
- Modify: `webapp/src/components/BottomNavigation.tsx`
- Modify: `webapp/src/components/webp-icon-types.ts`
- Modify: `webapp/src/features/feed/api.ts`
- Modify: `webapp/src/features/feed/queries.ts`
- Modify: `webapp/src/features/feed/index.ts`
- Modify: `assets/manifest.json`
- Add: `webapp/public/assets/brand/memoly-cloud-stars.webp`
- Add: `assets/icons/gear-{default,active}@{2x,3x}.webp`
- Add: `assets/icons/star-{default,active}@{2x,3x}.webp`
- Add/copy: matching `webapp/public/assets/icons/` files plus existing `heart`, `heart-filled`, and `video` variants
- Modify: `webapp/tests/design-system.test.tsx`
- Delete after migration: `webapp/src/features/feed/components/FeedShell.tsx`

**Interfaces:**
- Consumes: `FeedFilter`, `TelegramInsets`, `BrandLogo`, `WebpIcon`, real child name/subtitle/avatar URL, role, filter/navigation callbacks, and `ReactNode` content.
- Produces:

```ts
export type FeedPresentationProps = {
  activeFilter: FeedFilter
  childAvatarCrop?: { x: number; y: number; width: number; height: number } | null
  childName: string
  childSubtitle: string
  childAvatarUrl?: string | null
  children: React.ReactNode
  insets: TelegramInsets
  onFamily: () => void
  onFeed: () => void
  onFilterChange: (filter: FeedFilter) => void
  onMore?: () => void
  role: 'full' | 'viewer'
}

export type FeedFilter = 'all' | 'photo' | 'video' | 'voice' | 'note'
```

- [ ] **Step 1: Write the failing shell and navigation tests**

Add assertions to `webapp/tests/design-system.test.tsx` that render `FeedPresentation` and prove the new composition is absent before implementation:

```tsx
const html = renderToStaticMarkup(
  <FeedPresentation
    activeFilter="all"
    childName="Саша"
    childSubtitle="2 года 8 месяцев"
    insets={{ top: 0, right: 0, bottom: 0, left: 0 }}
    onFamily={() => undefined}
    onFeed={() => undefined}
    onFilterChange={() => undefined}
    role="full"
  >
    <article data-memory-id="m1" />
  </FeedPresentation>,
)
expect(html).toContain('data-memoly-feed="true"')
expect(html).toContain('data-slot="memoly-child-hero"')
expect(html).toContain('data-slot="memoly-filter-rail"')
expect(html).toContain('data-bottom-navigation-appearance="memoly"')
expect(html).toContain('aria-pressed="true"')
```

Keep the existing viewer assertion and extend it to prove the center item has `data-nav-viewer="true"` and no button named “Добавить”.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
bun test webapp/tests/design-system.test.tsx
```

Expected: FAIL because `FeedPresentation` and the `memoly` bottom-navigation appearance do not exist.

- [ ] **Step 3: Implement the minimal shell composition**

Create `FeedPresentation.tsx` with the UI Kit order and real callbacks. Define this exact filter metadata above the component:

```tsx
const filters: ReadonlyArray<{ icon?: WebpIconName; label: string; value: FeedFilter }> = [
  { label: 'Все', value: 'all' },
  { icon: 'photo', label: 'Фото', value: 'photo' },
  { icon: 'video', label: 'Видео', value: 'video' },
  { icon: 'voice', label: 'Голос', value: 'voice' },
  { icon: 'note', label: 'Заметки', value: 'note' },
]
```

The component body uses concrete semantic elements:

```tsx
export function FeedPresentation(props: FeedPresentationProps) {
  const style = {
    '--host-inset-top': `${props.insets.top}px`,
    '--host-inset-right': `${props.insets.right}px`,
    '--host-inset-bottom': `${props.insets.bottom}px`,
    '--host-inset-left': `${props.insets.left}px`,
  } as React.CSSProperties

  return (
    <div className="memoly-feed-page" data-memoly-feed="true" style={style}>
      <div className="memoly-feed-shell">
        <header className="memoly-topbar">
          <button aria-label="Помощь и конфиденциальность" className="memoly-circle-button" onClick={props.onMore} type="button"><WebpIcon decorative name="gear" size={22} /></button>
          <BrandLogo className="memoly-logo" />
          <span aria-hidden="true" />
        </header>
        <section className="memoly-child-hero" data-slot="memoly-child-hero">
          <ChildAvatar avatarCrop={props.childAvatarCrop} avatarUrl={props.childAvatarUrl} name={props.childName} size="feed-header" />
          <div className="memoly-child-copy"><h1>{props.childName}</h1><p>{props.childSubtitle}</p><span className="memoly-archive-pill"><WebpIcon decorative name="star" size={16} />Наши воспоминания</span></div>
          <img alt="" aria-hidden="true" className="memoly-cloud-art" src="/assets/brand/memoly-cloud-stars.webp" />
        </section>
        <div aria-label="Фильтр воспоминаний" className="memoly-filters" data-slot="memoly-filter-rail" role="group">
          {filters.map((item) => <button aria-pressed={item.value === props.activeFilter} key={item.value} onClick={() => props.onFilterChange(item.value)} type="button">{item.icon ? <WebpIcon decorative name={item.icon} size={18} /> : null}{item.label}</button>)}
        </div>
        <main className="memoly-feed-content">{props.children}</main>
        <BottomNavigation appearance="memoly" active="feed" onFamily={props.onFamily} onFeed={props.onFeed} role={props.role} />
      </div>
    </div>
  )
}
```

Add `appearance?: 'default' | 'memoly'` to `BottomNavigationProps`; emit `data-bottom-navigation-appearance={appearance}` and feed-scoped class names only for `memoly`. Do not change default behavior. Extend `webpIconNames` with `gear`, `heart`, `heart-filled`, `star`, and `video`; ensure every declared state resolves to an actual public WebP file and valid manifest entry.

Build the CSS from the UI Kit measurements: max width 460px, cream canvas, 79px top bar, 88px child avatar, 41px filter pills, 25px card radius, 88px navigation, 58px central Add circle, mobile edge-to-edge below 520px, and host inset variables. Use the approved navy/violet/pink palette from the kit instead of the old coral tokens inside `[data-memoly-feed]`.

- [ ] **Step 4: Run the same test and verify GREEN**

```powershell
bun test webapp/tests/design-system.test.tsx
```

Expected: all tests in the file pass with zero failures.

- [ ] **Step 5: Verify no Family presentation changed**

```powershell
bun test webapp/tests/navigation.test.ts webapp/tests/pages.test.ts
git diff -- webapp/src/features/family webapp/src/App.tsx
```

Expected: tests pass; the diff command prints no Family or App changes.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- assets/manifest.json assets/icons webapp/public/assets webapp/src/components/BottomNavigation.tsx webapp/src/components/webp-icon-types.ts webapp/src/features/feed/api.ts webapp/src/features/feed/queries.ts webapp/src/features/feed/index.ts webapp/src/features/feed/presentation webapp/src/features/feed/components/FeedShell.tsx webapp/tests/design-system.test.tsx
git diff --cached --check
git commit -m "feat(feed): add faithful memoLy presentation shell"
```

---

### Task 2: Render real memory DTOs through faithful cards without replacing media behavior

**Files:**
- Create: `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`
- Modify: `webapp/src/features/feed/presentation/index.ts`
- Modify: `webapp/src/features/feed/presentation/memoly-feed.css`
- Modify: `webapp/src/features/feed/FeedPage.tsx`
- Modify: `webapp/src/features/feed/components/index.ts`
- Modify: `webapp/tests/feed.test.tsx`

**Interfaces:**
- Consumes real `MemoryDto` values and already-rendered production media controls.
- Produces:

```ts
export type MemoryCardPresentationProps = {
  actions: React.ReactNode
  authorInitials: string
  authorName: string
  body: string
  kind: MemoryDto['kind']
  liked: boolean
  likeCount: number
  media: React.ReactNode
  memoryId: string
  occurredTime: string
  onLike: () => void
  onOpen: () => void
}
```

- [ ] **Step 1: Write failing presentation/card mapping tests**

Extend `webapp/tests/feed.test.tsx` with real DTO fixtures for photo, video, voice and note. Assert observable behavior rather than class text:

```tsx
expect(markup).toContain('data-memory-kind="photo"')
expect(markup).toContain('data-slot="memoly-author-row"')
expect(markup).toContain('aria-label="Поставить сердечко"')
expect(markup).toContain('data-slot="memoly-photo-layout"')
expect(markup).toContain('data-slot="memoly-video-layout"')
expect(markup).toContain('data-slot="memoly-voice-layout"')
expect(markup).toContain('data-slot="memoly-note-layout"')
expect(markup).not.toContain('/assets/photo-park.webp')
```

Add a viewer fixture and assert no delete action is rendered while the like button remains present and enabled.

- [ ] **Step 2: Run the focused feed tests and verify RED**

```powershell
bun test webapp/tests/feed.test.tsx
```

Expected: FAIL for missing memoLy presentation slots; existing media tests must still execute rather than error during setup.

- [ ] **Step 3: Implement `MemoryCardPresentation`**

Use a single semantic article with explicit kind layouts:

```tsx
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '•'
}

<article className={`memoly-memory memoly-memory-${kind}`} data-memory-id={memoryId} data-memory-kind={kind}>
  <div className="memoly-author" data-slot="memoly-author-row">
    <span aria-hidden="true" className="memoly-author-initials">{authorInitials}</span>
    <div><strong>{authorName}</strong><small>{occurredTime}</small></div>
    {actions}
  </div>
  {kind === 'photo' ? <div data-slot="memoly-photo-layout">{media}{captionAndLike}</div> : null}
  {kind === 'video' ? <div className="memoly-video-row" data-slot="memoly-video-layout">{media}{copyAndLike}</div> : null}
  {kind === 'voice' ? <div data-slot="memoly-voice-layout">{media}{captionAndLike}</div> : null}
  {kind === 'note' ? <div data-slot="memoly-note-layout">{noteBody}{like}</div> : null}
</article>
```

The component owns only chrome, menu placement and click targets. It must not fetch, create object URLs, synthesize waveforms, or render demo media.

- [ ] **Step 4: Recompose `FeedPage` around the new presentation**

Keep lines that implement query state, access loss, refresh, sentinel pagination, private object URLs, PhotoSwipe, `AudioPlayer`, `PrivateVideo`, Telegram and MAX video. Replace only the return composition and old `MemoryList`/`MemoryCard` frame:

```tsx
<MediaPlaybackCoordinator>
  <FeedPresentation
    activeFilter={filter}
    childAvatarUrl={childAvatarUrl}
    childAvatarCrop={childAvatarCrop}
    childName={childName}
    childSubtitle={childSubtitle}
    insets={insets}
    onFamily={onFamily}
    onFeed={() => undefined}
    onFilterChange={onFilterChange}
    role={role}
  >
    {newAvailable ? <Button onClick={() => void refreshFromTop(feed.refetch, knownFirstId, setNewAvailable)} type="button">Показать новые</Button> : null}
    {!isAppBootstrapped || feed.isPending ? <FeedSkeleton /> : null}
    {shouldRenderInitialFeedError({ isAppBootstrapped, isFeedError: feed.isError, isFeedPending: feed.isPending, itemCount: items.length }) ? <InlineError onRetry={() => void feed.refetch()} /> : null}
    {isAppBootstrapped && !feed.isPending && !feed.isError && items.length === 0 ? <EmptyState mode={role} /> : null}
    <MemoryList
      renderCard={(memory) => (
        <MemoryCardPresentation
          actions={memory.capabilities.delete ? <MemoryDeleteAction memory={memory} onDelete={onDelete} /> : null}
          authorInitials={initials(memory.author.name)}
          authorName={memory.author.name}
          body={memory.body}
          kind={memory.kind}
          liked={memory.likes.likedByMe}
          likeCount={memory.likes.count}
          media={primary ? <Attachment attachment={primary} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={0} transport={transport} /> : null}
          memoryId={memory.id}
          occurredTime={timeLabel(memory.occurredAt, familyTimezone)}
          onLike={() => onLike(memory)}
          onOpen={() => onOpen(memory)}
        />
      )}
    />
  </FeedPresentation>
</MediaPlaybackCoordinator>
```

Photo cards keep full-width media; video cards use the UI Kit two-column arrangement when content permits; voice retains the actual audio element, measured 48 peaks and seek input; notes contain no fake image/title/category. The like label switches between “Поставить сердечко” and “Убрать сердечко” and retains `aria-pressed`.

- [ ] **Step 5: Run focused tests and fix only presentation regressions**

```powershell
bun test webapp/tests/feed.test.tsx webapp/tests/playback.test.tsx webapp/tests/voice-waveform.test.ts webapp/tests/private-media-access.test.ts
```

Expected: all selected tests pass; existing PhotoSwipe/media contracts remain unchanged.

- [ ] **Step 6: Run typecheck and commit Task 2**

```powershell
bun run typecheck:webapp
git diff --check
git add -- webapp/src/features/feed/FeedPage.tsx webapp/src/features/feed/components/index.ts webapp/src/features/feed/presentation webapp/tests/feed.test.tsx
git diff --cached --check
git commit -m "feat(feed): connect real memories to memoLy cards"
```

---

### Task 3: Preserve end-to-end feed behavior across the new DOM

**Files:**
- Modify: `webapp/e2e/feed.spec.ts`
- Modify if a proven regression requires it: `webapp/src/features/feed/FeedPage.tsx`
- Modify if selector/layout correction is required: `webapp/src/features/feed/presentation/*.tsx`
- Modify if stacking/responsive correction is required: `webapp/src/features/feed/presentation/memoly-feed.css`

**Interfaces:**
- Consumes stable `data-slot`, `data-memory-id`, `data-memory-kind`, navigation and media selectors from Tasks 1–2.
- Produces browser evidence that the existing behavior still works through the new presentation.

- [ ] **Step 1: Add failing E2E assertions for the new DOM and restrictions**

Add assertions within existing scenarios rather than duplicating API mocks:

```ts
await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
await expect(page.locator('[data-slot="memoly-filter-rail"]')).toBeVisible()
await expect(page.locator('[data-memory-kind="photo"]')).toBeVisible()
await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
await expect(page.locator('[data-slot="telegram-video-play-control"]')).toHaveCSS('z-index', '10')
```

In the viewer-role scenario, assert the center navigation label is “Просмотр”, there is no Add button, delete is absent, and the heart remains actionable.

- [ ] **Step 2: Run the E2E spec and verify the expected failure before selector fixes**

```powershell
bun run --cwd webapp e2e -- feed.spec.ts
```

Expected: new presentation assertions fail before the DOM is connected; existing functional failures, if any, are recorded separately and not hidden.

- [ ] **Step 3: Adapt selectors and fix actual regressions**

Preserve the API mocks and behavioral assertions for:

- pagination failure/retry and 40+ deduplication;
- like rollback;
- applying new memories without losing the visible anchor;
- two-photo PhotoSwipe and focus/scroll restoration;
- voice/private video Range/206 and hidden-app pause;
- Telegram opaque handoff;
- delete confirmation/rollback;
- membership revoke;
- MAX intrinsic ratio/playback.

Only change selectors where the semantic element moved. If behavior fails, add the closest regression assertion before changing production code.

- [ ] **Step 4: Run component, E2E, typecheck and build gates**

```powershell
bun run test:webapp
bun run --cwd webapp e2e -- feed.spec.ts
bun run typecheck:webapp
bun run build:webapp
```

Expected: every command exits 0 and the test runners find non-zero tests.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- webapp/e2e/feed.spec.ts webapp/src/features/feed/FeedPage.tsx webapp/src/features/feed/presentation
git diff --cached --check
git commit -m "test(feed): preserve behavior through faithful UI"
```

---

### Task 4: Run the visual fidelity gate and responsive regression pass

**Files:**
- Modify only when mismatch evidence requires it: `webapp/src/features/feed/presentation/memoly-feed.css`
- Modify only when mismatch evidence requires it: `webapp/src/features/feed/presentation/*.tsx`
- Evidence (not committed): `D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\*`

**Interfaces:**
- Consumes the built production Feed and the original UI Kit from `D:\codex\memoLy-react-vite-kit.zip`.
- Produces viewport screenshots, a visual mismatch ledger, and final deterministic verification evidence.

- [ ] **Step 1: Prepare two isolated local render targets**

Run the production webapp with its existing representative feed fixture/mocked API path. Extract the UI Kit to a temporary directory outside the repository and run it independently. Never copy kit demo records into production.

Use separate ports, for example production `4173` and kit `4174`, and record the exact commands and PIDs in the evidence ledger.

- [ ] **Step 2: Capture equal 390px screenshots**

Using Playwright with viewport `{ width: 390, height: 844 }`, capture:

```text
D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\production-390.png
D:\codex\TG_OurMemoriesDevBot\audit-reports\memoly-ui-faithful\ui-kit-390.png
```

The production capture must contain representative photo, video, voice and note records using synthetic/test materials or controlled API fixtures.

- [ ] **Step 3: Write and resolve the mismatch ledger**

Create `visual-mismatch-ledger.md` beside the screenshots with one row per category:

```markdown
| Category | UI Kit/reference | Production | Severity | Resolution |
| header geometry | measured position/size | measured position/size | blocker/major/minor | CSS/component change |
```

Cover header, child identity, card size, media/text placement, typography, colors, radii, shadows, filters, spacing, bottom navigation, Add button and density. Fix blocker/major items, recapture, and repeat until no obvious designer-blocking difference remains.

- [ ] **Step 4: Capture responsive production viewports**

Capture and inspect:

```text
production-320.png
production-390.png
production-430.png
production-480.png
```

At each width verify no horizontal page scroll, all filters remain reachable, controls are at least 44px, long content does not overlap, bottom nav stays fixed, and video/play/duration overlays remain below it.

- [ ] **Step 5: Re-run functional browser interactions after visual fixes**

Exercise filters, load-more pagination, like/unlike, delete cancel/confirm/rollback, PhotoSwipe open/close, voice play/seek, private video play/seek/fullscreen capability, Telegram handoff, MAX playback/action, viewer restrictions and both working bottom-nav destinations. Record pass/fail and any environment-only limitation.

- [ ] **Step 6: Run fresh final verification**

```powershell
bun run test:webapp
bun run --cwd webapp e2e -- feed.spec.ts
bun run typecheck:webapp
bun run build:webapp
git diff --check 8281907a5091b57109bba4f3a733e42e042a5002..HEAD
git status --short --branch
```

Expected: tests/typecheck/build exit 0, no diff-check errors, status contains only intentional task changes, and screenshot/ledger paths exist.

- [ ] **Step 7: Commit visual corrections if any**

```powershell
git add -- webapp/src/features/feed/presentation webapp/src/features/feed/FeedPage.tsx
git diff --cached --check
git commit -m "fix(feed): close memoLy visual mismatches"
```

Do not commit screenshots containing private or representative family material.

---

### Task 5: Independent review and handoff gate

**Files:**
- Review range: `8281907a5091b57109bba4f3a733e42e042a5002..HEAD`
- Review evidence: screenshots, mismatch ledger, command output, and final Git status.

- [ ] **Step 1: Run deterministic checks from Task 4 again immediately before review**

Do not reuse stale output. Record exit codes and test counts.

- [ ] **Step 2: Dispatch a fresh reviewer with no implementation history**

Review P0/P1/P2 correctness, scope, private media/auth boundaries, interaction regressions, viewer permissions, overlay stacking, visual fidelity and forbidden demo assets. Confirmed in-scope findings may be fixed by the reviewer with a regression test.

- [ ] **Step 3: Dispatch a second fresh reviewer over the entire active change**

If the first reviewer fixed P0/P1/P2 issues, run the affected checks first. A second significant finding is adjudicated by the lead instead of starting an endless loop.

- [ ] **Step 4: Lead final audit**

Inspect the actual diff, changed paths, screenshot paths, mismatch ledger, review findings, base/head SHA and status. Confirm no Family/T09/backend/contracts changes and no push/PR/merge/deploy.

- [ ] **Step 5: Stop for manual acceptance**

Return the entire report in one Markdown code block with the exact final status:

```text
READY FOR MANUAL FEED VISUAL ACCEPTANCE
```

Do not begin another screen until the owner writes `Лента принята. Продолжай.`
