import { useRef, useState } from 'react'

import {
  AddSheet,
  DateHeading,
  EmptyState,
  FeedShell,
  FeedSkeleton,
  InlineError,
  MemoryCardFrame,
  type FeedFilter,
} from '@/features/feed'
import { createBrowserDevHostBridge } from '@/platform/telegram'
import { Typography } from '@/components/typography'

import beachPhoto from '../../../assets/demo/beach.webp'

export type DesignSystemFixtureState =
  | 'populated'
  | 'empty-full'
  | 'empty-viewer'
  | 'loading'
  | 'error'
  | 'add-sheet'

const availableStates: ReadonlySet<string> = new Set([
  'populated',
  'empty-full',
  'empty-viewer',
  'loading',
  'error',
  'add-sheet',
])

export function DesignSystemFixturePage({
  initialState,
}: {
  initialState?: DesignSystemFixtureState
}) {
  const [activeFilter, setActiveFilter] = useState<FeedFilter>('all')
  const [sheetOpen, setSheetOpen] = useState(() => resolveState(initialState) === 'add-sheet')
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const state = resolveState(initialState)
  const viewer = state === 'empty-viewer'
  const hostBridge = createBrowserDevHostBridge({
    insets: { top: 8, right: 0, bottom: 8, left: 0 },
  })

  return (
    <div data-fixture-state={state}>
      <FeedShell
        activeFilter={activeFilter}
        addButtonRef={addButtonRef}
        childName="Варя"
        childSubtitle="Наша семья"
        insets={hostBridge.getInsets()}
        onAdd={() => setSheetOpen(true)}
        onFilterChange={setActiveFilter}
        role={viewer ? 'viewer' : 'full'}
      >
        {state === 'loading' ? <FeedSkeleton /> : null}
        {state === 'empty-full' ? <EmptyState mode="full" onOpenBot={() => undefined} /> : null}
        {state === 'empty-viewer' ? <EmptyState mode="viewer" /> : null}
        {state === 'error' ? (
          <>
            <InlineError onRetry={() => undefined} />
            <FixtureFeed />
          </>
        ) : null}
        {state === 'populated' || state === 'add-sheet' ? <FixtureFeed /> : null}
      </FeedShell>
      <AddSheet
        onOpenChange={setSheetOpen}
        open={sheetOpen}
        returnFocusRef={addButtonRef}
      />
    </div>
  )
}

function FixtureFeed() {
  return (
    <>
      <DateHeading>9 сентября 2026</DateHeading>
      <MemoryCardFrame>
        <div className="px-4 py-4">
          <Typography variant="memoryBody">Сегодня сама придумала историю про облако</Typography>
          <Typography className="mt-3" tone="muted" variant="memoryMeta">18:42 · Мама</Typography>
        </div>
      </MemoryCardFrame>
      <MemoryCardFrame>
        <img
          alt="Синтетический пример семейной фотографии"
          className="aspect-[4/3] w-full object-cover"
          decoding="async"
          src={beachPhoto}
        />
        <div className="px-4 py-4">
          <Typography variant="memoryBodyMedium">Первый раз на море</Typography>
          <Typography className="mt-2" tone="muted" variant="memoryMeta">17:10 · Папа</Typography>
        </div>
      </MemoryCardFrame>
    </>
  )
}

function resolveState(
  initialState: DesignSystemFixtureState | undefined,
): DesignSystemFixtureState {
  if (initialState) return initialState
  if (typeof window === 'undefined') return 'populated'

  const requestedState = new URLSearchParams(window.location.search).get('state')
  return requestedState && availableStates.has(requestedState)
    ? requestedState as DesignSystemFixtureState
    : 'populated'
}
