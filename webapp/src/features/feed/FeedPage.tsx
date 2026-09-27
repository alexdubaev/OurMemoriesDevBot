import type { MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import 'photoswipe/style.css'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { privateMediaSource } from '@/platform/media/private-media-access'
import { responseToPrivateImageObjectUrl } from '@/platform/media/private-image'
import { toggleMediaPlayback } from '@/platform/media/playback'
import type { HostBridge, TelegramInsets } from '@/platform/telegram'
import { loadFeed, openTelegramVideo } from './api'
import { navigateToTelegramVideo, useSingleFlightTelegramVideoHandoff } from './telegram-video-handoff'
import { EmptyState, FeedSkeleton, InlineError, type FeedFilter } from './components'
import { FeedPresentation, MemoryCardPresentation } from './presentation'
import { feedQueryKeys, useFeedQuery, useMemoryDelete, useMemoryLike } from './queries'
import { refreshFromTop, shouldCheckForNew, shouldRefreshInitialEmptyFeed } from './live-refresh'
import { MediaPlaybackCoordinator } from './playback'
import { usePlaybackRegistration } from './use-playback-registration'
import { isVoiceWaveformPeakPlayed, voiceWaveformProgress } from './voice-waveform'
import { shouldRenderInitialFeedError } from '@/features/app'
import { useChildAvatar } from '@/features/family'
import { MemoryEditor, NoteComposer, PhotoComposer } from '@/features/composer'
import { AddSheetPresentation } from '@/features/memoly-ui'
import { VideoComposer } from '@/features/max-video-upload'
import { composerModeForAdd, type ComposerMode } from './composer-routing'
import { loadMaxVideoSourceOnce } from './max-video-source'
import { MemoryDeleteSpotlight } from './MemoryDeleteSpotlight'
import { useMemorySeenObserver } from './use-memory-seen-observer'

type Props = {
  childId?: string
  childName: string
  childSubtitle: string
  childAvatarCrop?: { x: number; y: number; width: number; height: number } | null
  childAvatarMediaId?: string | null
  familyId: string
  familyName: string
  familyTimezone: string
  accountId?: string
  membershipEpoch?: number | null
  unreadCount?: number | null
  unreadState?: 'ready' | 'unavailable' | 'not_enabled'
  onSeenCandidate?: (memoryId: string) => void
  filter: FeedFilter
  hostBridge: HostBridge
  insets: TelegramInsets
  isAppBootstrapped?: boolean
  maxVideoUploadAcceptance?: boolean
  onMaxVideoLaunchHandled?: () => void
  onFamily: () => void
  onAllFamilies: () => void
  onFilterChange: (filter: FeedFilter) => void
  onAccessLost: () => void
  openAddInitially?: boolean
  role: 'full' | 'viewer'
  transport: AuthenticatedTransport
}

export function FeedPage({
  accountId = '', childAvatarCrop = null, childAvatarMediaId = null, childId, childName, childSubtitle, familyId, familyName, familyTimezone, filter, hostBridge, insets, membershipEpoch = null, unreadCount = null, unreadState = 'not_enabled', onSeenCandidate, onFamily, onAllFamilies,
  isAppBootstrapped = true, maxVideoUploadAcceptance = false, onMaxVideoLaunchHandled, onAccessLost, onFilterChange, role, transport,
  openAddInitially = false,
}: Props) {
  const queryClient = useQueryClient()
  const childAvatarUrl = useChildAvatar(transport, familyId, childAvatarMediaId)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [unreadCycle, setUnreadCycle] = useState(0)
  const feed = useFeedQuery(transport, familyId, filter, unreadOnly, accountId, membershipEpoch ?? 0, unreadOnly ? unreadCycle : 0)
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = feed
  const { refetch } = feed
  const like = useMemoryLike(transport, familyId, filter, unreadOnly, accountId, membershipEpoch ?? 0, unreadOnly ? unreadCycle : 0)
  const [actionsMemory, setActionsMemory] = useState<MemoryDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MemoryDto | null>(null)
  const [deleteTargetIndex, setDeleteTargetIndex] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const deletion = useMemoryDelete(transport, familyId, () => undefined)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [detail, setDetail] = useState<MemoryDto | null>(null)
  const detailReturnFocusRef = useRef<HTMLElement | null>(null)
  const [addSheetOpen, setAddSheetOpen] = useState(openAddInitially && role === 'full')
  const [composer, setComposer] = useState<ComposerMode | null>(maxVideoUploadAcceptance ? 'video' : null)
  const [editingMemory, setEditingMemory] = useState<MemoryDto | null>(null)
  const registerSeenContent = useMemorySeenObserver(Boolean(onSeenCandidate && membershipEpoch && unreadState !== 'not_enabled'), Boolean(detail || addSheetOpen || actionsMemory || deleteTarget), (id) => onSeenCandidate?.(id))
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const feedScope = useMemo(() => ({ familyId, filter, unreadOnly, unreadCycle }), [familyId, filter, unreadOnly, unreadCycle])
  const [newAvailableFor, setNewAvailableFor] = useState<typeof feedScope | null>(null)
  const [refreshErrorFor, setRefreshErrorFor] = useState<typeof feedScope | null>(null)
  const newAvailable = newAvailableFor === feedScope
  const refreshError = refreshErrorFor === feedScope
  const knownFirstId = useRef<string | null>(null)
  const pendingNewRefresh = useRef(false)
  const currentScope = useRef(feedScope)
  const onAccessLostRef = useRef(onAccessLost)
  useLayoutEffect(() => { onAccessLostRef.current = onAccessLost }, [onAccessLost])
  const items = useMemo(() => {
    const unique = new Map<string, MemoryDto>()
    for (const page of feed.data?.pages ?? []) {
      for (const memory of page.items) if (!unique.has(memory.id)) unique.set(memory.id, memory)
    }
    return [...unique.values()]
  }, [feed.data])
  const visibleItems = useMemo(() => {
    if (!deleteTarget || items.some((memory) => memory.id === deleteTarget.id)) return items
    const next = [...items]
    const index = Math.max(0, Math.min(deleteTargetIndex ?? next.length, next.length))
    next.splice(index, 0, deleteTarget)
    return next
  }, [deleteTarget, deleteTargetIndex, items])

  useEffect(() => {
    knownFirstId.current = null
  }, [familyId, filter, accountId, membershipEpoch])

  useEffect(() => {
    if (!unreadOnly && !knownFirstId.current && items[0]) knownFirstId.current = items[0].id
  }, [items, unreadOnly])

  useEffect(() => {
    currentScope.current = feedScope
    if (unreadOnly || !pendingNewRefresh.current) return
    pendingNewRefresh.current = false
    void refreshFromTop(refetch, knownFirstId, () => currentScope.current === feedScope, () => setNewAvailableFor(null))
  }, [feedScope, refetch, unreadOnly])

  useEffect(() => {
    const error = feed.error
    if (!(error instanceof ApiRequestError) || ![403, 404].includes(error.status)) return
    void queryClient.cancelQueries({ queryKey: [...feedQueryKeys.all, familyId] }).finally(() => {
      queryClient.removeQueries({ queryKey: [...feedQueryKeys.all, familyId] })
      onAccessLost()
    })
  }, [familyId, feed.error, onAccessLost, queryClient])

  useEffect(() => {
    let checking = false
    let rerunRequested = false
    let disposed = false
    const checkForNew = async () => {
      if (checking && !document.hidden) { rerunRequested = true; return }
      if (!shouldCheckForNew({ checking, hidden: document.hidden })) return
      checking = true
      try {
        const latest = await loadFeed(transport, familyId, filter, null)
        if (disposed) return
        const latestFirstId = latest.items[0]?.id ?? null
        if (unreadOnly && knownFirstId.current === null) {
          knownFirstId.current = latestFirstId
          return
        }
        if (!unreadOnly && shouldRefreshInitialEmptyFeed({ knownFirstId: knownFirstId.current, latestFirstId })) {
          await refreshFromTop(refetch, knownFirstId, () => !disposed && currentScope.current === feedScope, () => setNewAvailableFor(null))
        } else if (latestFirstId && latestFirstId !== knownFirstId.current) {
          setNewAvailableFor(feedScope)
        }
      } catch (error) {
        if (!disposed && error instanceof ApiRequestError && [403, 404].includes(error.status)) onAccessLostRef.current()
      } finally {
        checking = false
        if (rerunRequested && !disposed) {
          rerunRequested = false
          void checkForNew()
        }
      }
    }
    const onVisibility = () => { if (!document.hidden) void checkForNew() }
    const timer = window.setInterval(() => { void checkForNew() }, 15_000)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [familyId, feedScope, filter, refetch, transport, unreadOnly])

  useEffect(() => {
    const target = sentinel.current
    if (!target || !hasNextPage) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
    }, { rootMargin: '320px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage])

  const closeComposerAfterRefresh = async () => {
    try { await refetch() } finally { setComposer(null); setEditingMemory(null) }
  }

  const cancelDelete = useCallback(() => {
    if (deletion.isPending) return
    setDeleteTarget(null)
    setDeleteTargetIndex(null)
    setDeleteError(null)
    actionTriggerRef.current?.focus({ preventScroll: true })
  }, [deletion.isPending])

  useEffect(() => {
    if (!deleteTarget) return undefined
    return hostBridge.onBack(() => {
      if (!deletion.isPending) cancelDelete()
    })
  }, [cancelDelete, deleteTarget, deletion.isPending, hostBridge])

  useEffect(() => {
    if (!actionsMemory) return undefined
    return hostBridge.onBack(() => setActionsMemory(null))
  }, [actionsMemory, hostBridge])

  if (composer === 'video' && childId) {
    return <VideoComposer childId={childId} familyId={familyId} familyTimezone={familyTimezone} onCancel={() => { setComposer(null); onMaxVideoLaunchHandled?.() }} onSuccess={async () => { await closeComposerAfterRefresh(); onMaxVideoLaunchHandled?.() }} transport={transport} />
  }

  if (composer === 'photo' && childId) {
    return <PhotoComposer childId={childId} familyId={familyId} familyTimezone={familyTimezone} onCancel={() => setComposer(null)} onSuccess={closeComposerAfterRefresh} transport={transport} />
  }

  if (composer === 'note' && childId) {
    return <NoteComposer childId={childId} familyId={familyId} familyTimezone={familyTimezone} onCancel={() => setComposer(null)} onSuccess={closeComposerAfterRefresh} transport={transport} />
  }

  if (editingMemory) {
    return <MemoryEditor familyTimezone={familyTimezone} memory={editingMemory} onCancel={() => setEditingMemory(null)} onSuccess={closeComposerAfterRefresh} transport={transport} />
  }

  return (
    <MediaPlaybackCoordinator>
    <FeedPresentation activeFilter={filter} childAvatarCrop={childAvatarCrop} childAvatarUrl={childAvatarUrl} childName={childName} childSubtitle={childSubtitle} familyName={familyName} insets={insets}
      addButtonRef={addButtonRef} onAdd={() => setAddSheetOpen(true)}
      onAllFamilies={onAllFamilies} onFamily={onFamily} onFeed={() => undefined} onFilterChange={(next) => { if (unreadOnly) setUnreadCycle((value) => value + 1); onFilterChange(next) }}
      onUnreadChange={(next) => { if (next && !unreadOnly) setUnreadCycle((value) => value + 1); setUnreadOnly(next) }}
      role={role} unreadCount={unreadCount} unreadOnly={unreadOnly} unreadState={unreadState}>
      {unreadOnly ? <div className="feed-unread-note"><Typography as="p" variant="memoryMeta">Просмотренные карточки останутся на месте до обновления списка. Фильтр типа действует отдельно.</Typography><Button onClick={() => { window.scrollTo({ top: 0, behavior: 'auto' }); setUnreadCycle((value) => value + 1) }} type="button" variant="outline">Обновить список</Button></div> : null}
      {newAvailable ? <div className="feed-new-available" role="status"><div><Typography as="span" variant="bodySm">Есть новые воспоминания</Typography>{refreshError ? <Typography as="p" role="alert" variant="bodySm">Не удалось обновить ленту. Повторите попытку.</Typography> : null}</div><Button onClick={() => { if (unreadOnly) { pendingNewRefresh.current = true; setUnreadOnly(false); setNewAvailableFor(null); return } void refreshFromTop(feed.refetch, knownFirstId, () => currentScope.current === feedScope, () => setNewAvailableFor(null)).then((success) => { if (currentScope.current === feedScope) setRefreshErrorFor(success ? null : feedScope) }) }} type="button">Показать новые</Button></div> : null}
      {!isAppBootstrapped || feed.isPending ? <FeedSkeleton /> : null}
      {shouldRenderInitialFeedError({ isAppBootstrapped, isFeedError: feed.isError, isFeedPending: feed.isPending, itemCount: items.length }) ? <InlineError onRetry={() => void feed.refetch()} /> : null}
      {isAppBootstrapped && !feed.isPending && !feed.isError && visibleItems.length === 0 ? unreadOnly
        ? <div className="feed-unread-empty" role="status"><Typography as="h2" variant="memoryEmptyTitle">Все новые воспоминания просмотрены</Typography><Typography as="p" variant="memoryBody">{filter === 'all' ? 'Новых воспоминаний пока нет.' : 'Для выбранного типа новых воспоминаний нет.'}</Typography><Button onClick={() => setUnreadOnly(false)} type="button">Показать все</Button></div>
        : <EmptyState filtered={filter !== 'all'} mode={role} onResetFilter={() => onFilterChange('all')} /> : null}
      {isAppBootstrapped && !feed.isPending && visibleItems.length > 0 ? <MemoryList familyTimezone={familyTimezone} items={visibleItems} renderCard={(memory) => {
        const primary = memory.attachments[0]
        const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> =>
          attachment.source === 'private_storage' && attachment.kind === 'photo')
        return <MemoryCardPresentation
          actions={<MemoryActions memory={memory} onOpen={(target, trigger) => { actionTriggerRef.current = trigger; setActionsMemory(target) }} />}
          isDeleteSource={deleteTarget?.id === memory.id}
          authorInitials={initials(memory.author.name)}
          authorName={memory.author.name}
          childName={memory.childId === childId ? childName : undefined}
          childAvatarUrl={memory.childId === childId ? childAvatarUrl : null}
          childAvatarCrop={memory.childId === childId ? childAvatarCrop : null}
          body={memory.body}
          kind={memory.kind}
          liked={memory.likes.likedByMe}
          likeCount={memory.likes.count}
          media={primary ? <Attachment attachment={primary} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={0} registerFullscreen={memory.author.id !== accountId ? registerSeenContent(memory.id, 'fullscreen') : undefined} transport={transport} /> : null}
          memoryId={memory.id}
          seenContentRef={memory.author.id !== accountId ? registerSeenContent(memory.id, 'feed') : undefined}
          occurredTime={timeLabel(memory.occurredAt, familyTimezone)}
          onLike={() => like.mutate({ memoryId: memory.id, liked: !memory.likes.likedByMe })}
          onOpen={() => { detailReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDetail(memory) }}
        />
      }} /> : null}
      <div aria-hidden="true" data-testid="feed-load-more-sentinel" ref={sentinel} />
      {feed.isFetchingNextPage ? <FeedSkeleton /> : null}
      {feed.isFetchNextPageError && items.length > 0 ? unreadOnly && feed.error instanceof ApiRequestError && feed.error.status === 409
        ? <div className="feed-unread-restart" role="status"><Typography as="p" variant="memoryMeta">Список изменился. Обновите непросмотренные, чтобы продолжить.</Typography><Button onClick={() => { window.scrollTo({ top: 0, behavior: 'instant' }); setUnreadCycle((value) => value + 1) }} type="button">Обновить список</Button></div>
        : <InlineError nextPage onRetry={() => void feed.fetchNextPage()} /> : null}
      {detail ? <MemoryDetail familyTimezone={familyTimezone} hostBridge={hostBridge} memory={detail} onClose={() => setDetail(null)} registerSeenContent={detail.author.id !== accountId ? registerSeenContent : undefined} returnFocusRef={detailReturnFocusRef} transport={transport} /> : null}
    </FeedPresentation>
    <AddSheetPresentation
      hostBridge={hostBridge}
      onNote={() => { const next = composerModeForAdd('note', childId); if (next) setComposer(next) }}
      onOpenChange={setAddSheetOpen}
      onPhoto={() => { const next = composerModeForAdd('photo', childId); if (next) setComposer(next) }}
      onVideo={() => { const next = composerModeForAdd('video', childId); if (next) setComposer(next) }}
      open={addSheetOpen}
      returnFocusRef={addButtonRef}
      role={role}
    />
    <MemolyBottomSheet
      onOpenChange={(open) => { if (!open) setActionsMemory(null) }}
      open={actionsMemory !== null}
      returnFocusRef={actionTriggerRef}
    >
      {actionsMemory ? (
        <MemoryActionsContent
          memory={actionsMemory}
          onDelete={actionsMemory.capabilities.delete ? () => {
            setActionsMemory(null)
            setDeleteError(null)
            setDeleteTargetIndex(items.findIndex((item) => item.id === actionsMemory.id))
            setDeleteTarget(actionsMemory)
          } : undefined}
          onDetails={() => { detailReturnFocusRef.current = actionTriggerRef.current; setActionsMemory(null); setDetail(actionsMemory) }}
          onEdit={actionsMemory.capabilities.edit ? () => { setActionsMemory(null); setEditingMemory(actionsMemory) } : undefined}
        />
      ) : null}
    </MemolyBottomSheet>
    <MemoryDeleteSpotlight
      error={deleteError}
      memory={deleteTarget}
      onCancel={cancelDelete}
      onConfirm={() => {
        if (!deleteTarget || deletion.isPending) return
        setDeleteError(null)
        void deletion.mutateAsync({ memoryId: deleteTarget.id, version: deleteTarget.version })
          .then(() => { setDeleteTarget(null); setDeleteTargetIndex(null); setDeleteError(null) })
          .catch(() => { setDeleteError('Не удалось удалить воспоминание. Попробуйте ещё раз.') })
      }}
      open={deleteTarget !== null}
      preview={deleteTarget ? <MemoryDeletePreview familyTimezone={familyTimezone} memory={deleteTarget} transport={transport} /> : null}
      submitting={deletion.isPending}
    />
    </MediaPlaybackCoordinator>
  )
}

function Attachment({ attachment, hostBridge, memory, photoAlbum = [], photoIndex = 0, registerFullscreen, transport }: {
  attachment: MemoryAttachment
  hostBridge: HostBridge
  memory: MemoryDto
  photoAlbum?: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex?: number
  registerFullscreen?: (element: HTMLElement | null) => void
  transport: AuthenticatedTransport
}) {
  if (attachment.source === 'telegram') return <TelegramVideo attachment={attachment} familyId={memory.familyId} hostBridge={hostBridge} memoryId={memory.id} transport={transport} />
  if (attachment.source === 'max') return <MaxVideo attachment={attachment} hostBridge={hostBridge} />
  if (attachment.kind === 'photo') return <PrivateImage attachment={attachment} hostBridge={hostBridge} photoAlbum={photoAlbum.length > 0 ? photoAlbum : [attachment]} photoIndex={photoIndex} registerFullscreen={registerFullscreen} transport={transport} />
  if (attachment.kind === 'voice') return <AudioPlayer durationMs={attachment.durationMs} path={attachment.playbackPath} waveform={attachment.waveform} />
  return <PrivateVideo path={attachment.playbackPath} />
}

export function TelegramVideo({ attachment, familyId, hostBridge, memoryId, transport }: { attachment: Extract<MemoryAttachment, { source: 'telegram' }>; familyId: string; hostBridge: HostBridge; memoryId: string; transport: AuthenticatedTransport }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [posterReadyUrl, setPosterReadyUrl] = useState<string | null>(null)
  const posterUrl = usePrivateObjectUrl(attachment.thumbnailPath, transport)
  const handoff = useSingleFlightTelegramVideoHandoff(async () => {
    setBusy(true); setFailed(false)
    try {
      await navigateToTelegramVideo(hostBridge, () => openTelegramVideo(transport, familyId, memoryId))
    } catch (error) {
      setFailed(true); setBusy(false)
      throw error
    }
  })
  const openHandoff = () => { void handoff().catch(() => undefined) }
  return <div className="ml-media-slot bg-muted">
    <TelegramVideoPoster busy={busy} disabled={busy} durationMs={attachment.durationMs} height={attachment.height} onOpen={openHandoff} onPosterReady={setPosterReadyUrl} posterReady={Boolean(posterUrl && posterReadyUrl === posterUrl)} posterUrl={posterUrl} width={attachment.width} />
    {failed ? <Typography className="px-5 py-3 text-center" role="alert" variant="memoryMeta">Не удалось открыть видео в Telegram. Попробуйте ещё раз.</Typography> : null}
  </div>
}

function MemoryList({ familyTimezone, items, renderCard }: {
  familyTimezone: string
  items: MemoryDto[]
  renderCard: (memory: MemoryDto) => ReactNode
}) {
  return <>{items.map((memory, index) => {
    const date = dayLabel(memory.occurredAt, familyTimezone)
    const previousDate = index > 0 ? dayLabel(items[index - 1]!.occurredAt, familyTimezone) : null
    return <section className="feed-section" data-kind={memory.kind} key={memory.id}>
      {date !== previousDate ? <Typography as="h2" className="date-heading" data-slot="date-heading" variant="memoryDate">{date}</Typography> : null}
      {renderCard(memory)}
    </section>
  })}</>
}

function MemoryActions({ memory, onOpen }: { memory: MemoryDto; onOpen: (memory: MemoryDto, trigger: HTMLButtonElement) => void }) {
  return <button aria-label="Действия с воспоминанием" className="flex size-11 items-center justify-center rounded-full text-muted-foreground" onClick={(event) => onOpen(memory, event.currentTarget)} type="button"><WebpIcon decorative name="more" size={24} /></button>
}

function MemoryActionsContent({ memory, onDelete, onDetails, onEdit }: { memory: MemoryDto; onDelete?: () => void; onDetails: () => void; onEdit?: () => void }) {
  return <div className="memoly-memory-actions" data-memory-actions-for={memory.id}>
    <DrawerTitle className="sr-only">Действия с воспоминанием</DrawerTitle>
    <DrawerDescription className="sr-only">Выберите действие для этого воспоминания.</DrawerDescription>
    <div className="memoly-memory-actions-list">
      <button className="memoly-memory-action" onClick={onDetails} type="button">
        <span className="memoly-memory-action-icon"><WebpIcon decorative monochrome name="circle-info" size={18} /></span>
        <span className="memoly-memory-action-copy"><Typography as="span" className="memoly-memory-action-title" variant="memoryBody">Подробнее</Typography><Typography as="span" className="memoly-memory-action-subtitle" variant="memoryMeta">Открыть публикацию целиком</Typography></span>
        <span className="memoly-memory-action-chevron"><WebpIcon decorative name="chevron" size={16} /></span>
      </button>
      {onEdit ? <button className="memoly-memory-action state-action-row" onClick={onEdit} type="button">
        <span className="memoly-memory-action-icon state-action-icon"><WebpIcon decorative monochrome name="pencil" size={18} /></span>
        <span className="memoly-memory-action-copy state-action-copy"><Typography as="span" className="memoly-memory-action-title" variant="memoryBody">Редактировать</Typography><Typography as="span" className="memoly-memory-action-subtitle" variant="memoryMeta">Изменить подпись или дату</Typography></span>
        <span className="memoly-memory-action-chevron state-chevron"><WebpIcon decorative name="chevron" size={16} /></span>
      </button> : null}
      {onDelete ? <button className="memoly-memory-action is-danger" onClick={onDelete} type="button">
        <span className="memoly-memory-action-icon"><WebpIcon decorative monochrome name="trash-can" size={18} /></span>
        <span className="memoly-memory-action-copy"><Typography as="span" className="memoly-memory-action-title" variant="memoryBody">Удалить воспоминание</Typography><Typography as="span" className="memoly-memory-action-subtitle" variant="memoryMeta">Удалить из семейной ленты</Typography></span>
        <span className="memoly-memory-action-chevron"><WebpIcon decorative name="chevron" size={16} /></span>
      </button> : null}
    </div>
  </div>
}

function MemoryDeletePreview({ familyTimezone, memory, transport }: { familyTimezone: string; memory: MemoryDto; transport: AuthenticatedTransport }) {
  const primary = memory.attachments[0]
  return <div className="memoly-delete-preview-card" data-memoly-feed>
    <MemoryCardPresentation
      actions={null}
      authorInitials={initials(memory.author.name)}
      authorName={memory.author.name}
      body={memory.body}
      kind={memory.kind}
      liked={memory.likes.likedByMe}
      likeCount={memory.likes.count}
      media={primary ? <MemoryDeletePreviewMedia attachment={primary} transport={transport} /> : null}
      memoryId={memory.id}
      mode="delete-preview"
      occurredTime={timeLabel(memory.occurredAt, familyTimezone)}
      onLike={() => undefined}
      onOpen={() => undefined}
    />
  </div>
}

function MemoryDeletePreviewMedia({ attachment, transport }: { attachment: MemoryAttachment; transport: AuthenticatedTransport }) {
  const path = attachment.source === 'telegram'
    ? attachment.thumbnailPath
    : attachment.source === 'private_storage' && attachment.kind === 'photo'
      ? attachment.displayPath ?? attachment.previewPath
      : null
  const url = usePrivateObjectUrl(path, transport)
  if (attachment.source === 'telegram') {
    return <div className="memoly-delete-static-media memoly-delete-static-video" style={{ aspectRatio: videoPosterAspectRatio(attachment.width, attachment.height) }}>
      {url ? <img alt="" className="size-full object-cover" src={url} /> : <Typography as="span" tone="muted" variant="memoryBody">Видео</Typography>}
      <WebpIcon decorative name="play" size={24} state="white" />
    </div>
  }
  if (attachment.source === 'private_storage' && attachment.kind === 'photo') {
    return url ? <img alt="" className="block h-auto max-h-[62dvh] w-full object-contain" src={url} /> : <div aria-hidden="true" className="memoly-delete-static-media" style={{ aspectRatio: mediaAspectRatio(attachment.width, attachment.height) ?? '4 / 3' }} />
  }
  if (attachment.kind === 'voice') {
    const peaks = attachment.waveform?.length === 48 ? attachment.waveform : Array.from({ length: 32 }, () => .35)
    return <div className="memoly-delete-static-media memoly-delete-static-voice"><div className="memoly-delete-static-waveform">{peaks.map((peak, index) => <span key={index} style={{ height: `${Math.max(10, Math.min(100, peak * 100))}%` }} />)}</div><Typography as="span" tone="muted" variant="memoryMeta">Голосовое сообщение</Typography></div>
  }
  return <div aria-hidden="true" className="memoly-delete-static-media memoly-delete-static-video" style={{ aspectRatio: videoPosterAspectRatio(attachment.width, attachment.height) }}><WebpIcon decorative name="play" size={24} state="white" /></div>
}

export function TelegramVideoPoster({ durationMs, posterUrl, posterReady = false, onPosterReady, width, height, onOpen = () => undefined, disabled = false, busy = false }: {
  durationMs: number | null; posterUrl: string | null; width: number | null; height: number | null
  onOpen?: () => void; onPosterReady?: (url: string | null) => void; posterReady?: boolean; disabled?: boolean; busy?: boolean
}) {
  const aspectRatio = videoPosterAspectRatio(width, height)
  return <button aria-label="Смотреть видео в Telegram" className="relative isolate block w-full overflow-hidden bg-muted text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60" data-seen-ready={posterReady} disabled={disabled} onClick={onOpen} style={{ aspectRatio }} type="button">
    {posterUrl
      ? <img alt="Кадр видео" className="size-full object-cover" onError={() => onPosterReady?.(null)} onLoad={(event) => { const image = event.currentTarget; void image.decode().then(() => onPosterReady?.(posterUrl)).catch(() => onPosterReady?.(null)) }} src={posterUrl} />
      : <span className="absolute inset-0 flex items-center justify-center"><Typography as="span" tone="muted" variant="memoryBody">Видео</Typography></span>}
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" data-slot="telegram-video-play-control">
      {busy
        ? <Typography as="span" className="rounded-full bg-black/65 px-4 py-2 text-white shadow-sm backdrop-blur-[1px]" variant="memoryMeta">Открываем видео…</Typography>
        : <span className="flex size-14 items-center justify-center rounded-full bg-black/65 shadow-sm backdrop-blur-[1px]"><WebpIcon decorative name="play" size={24} state="white" /></span>}
    </span>
    <Typography as="span" className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-black/70 px-2 py-1 text-white" variant="memoryMeta">{formatDuration(durationMs)}</Typography>
  </button>
}

function MaxVideo({ attachment, hostBridge }: {
  attachment: Extract<MemoryAttachment, { source: 'max' }>
  hostBridge: HostBridge
}) {
  const source = useMaxVideoSource(attachment.playbackPath)
  return <MaxVideoPreview durationMs={attachment.durationMs} height={attachment.height} onOpen={() => hostBridge.openBot()} onRetry={attachment.playbackPath ? source.retry : undefined} sourceStatus={source.status} src={source.url} width={attachment.width} />
}

type MaxVideoPreviewProps = {
  durationMs: number | null
  height: number | null
  onOpen: () => void
  onRetry?: () => void
  sourceStatus?: 'loading' | 'ready' | 'error'
  src: string | null
  width: number | null
}

export function MaxVideoPreview(props: MaxVideoPreviewProps) {
  return <MaxVideoPreviewContent key={props.src ?? 'missing'} {...props} />
}

function MaxVideoPreviewContent({ durationMs, height, onOpen, onRetry, sourceStatus, src, width }: MaxVideoPreviewProps) {
  const video = useRef<HTMLVideoElement | null>(null)
  const activate = usePlaybackRegistration(`max-video:${src ?? 'missing'}`, video)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [mediaErrorCode, setMediaErrorCode] = useState(0)
  const [intrinsicDimensions, setIntrinsicDimensions] = useState<{ width: number; height: number } | null>(null)
  const loadedSource = useRef<string | null>(null)
  const sourceFailed = sourceStatus === 'error'
  const viewerState = sourceFailed || failed ? 'error' : src ? 'ready' : 'loading'
  const frameDimensions = intrinsicDimensions ?? { width, height }
  const frameStyle = videoFrameStyle(frameDimensions.width, frameDimensions.height)
  useEffect(() => {
    const element = video.current
    if (element) loadedSource.current = loadMaxVideoSourceOnce(element, src, loadedSource.current)
  }, [src])
  return <div aria-label="Видео" className="ml-media-slot memoly-video-viewer-v2 w-full" data-seen-ready={viewerState === 'ready' && previewReady} data-video-started={started} data-video-viewer-state={viewerState}>
    <div className="relative isolate max-h-[75dvh] w-full overflow-hidden bg-muted memoly-video-viewer-v2-frame" data-media-error-code={mediaErrorCode} data-slot="max-video-frame" style={frameStyle}>
      <video aria-label="Предпросмотр видео" className="absolute inset-0 size-full object-contain" controls onError={(event) => { const code = event.currentTarget.error?.code; const sanitizedCode = typeof code === 'number' && Number.isInteger(code) && code >= 0 ? code : 0; setMediaErrorCode(sanitizedCode); setFailed(true); setPreviewReady(false) }} onLoadedData={() => setPreviewReady(true)} onLoadedMetadata={(event) => {
        const element = event.currentTarget
        if (Number.isFinite(element.videoWidth) && Number.isFinite(element.videoHeight) && element.videoWidth > 0 && element.videoHeight > 0) {
          setIntrinsicDimensions({ width: element.videoWidth, height: element.videoHeight })
        }
        const seekableEnd = element.seekable.length > 0 ? element.seekable.end(element.seekable.length - 1) : 0
        if ((Number.isFinite(element.duration) && element.duration > 0.001) || seekableEnd > 0.001) {
          try { element.currentTime = 0.001 } catch { /* Some WebViews reject a seek before the first frame is buffered. */ }
        }
      }} onPlay={() => { activate(); setStarted(true) }} preload="metadata" playsInline ref={video} />
      {!started && !failed && !sourceFailed ? <button aria-label="Смотреть видео" className="absolute inset-0 z-10 flex items-center justify-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50" disabled={!src} onClick={() => void (async () => {
        const element = video.current
        if (!element) return
        try { await element.play() } catch { setFailed(true) }
      })()} type="button">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-black/65 shadow-sm backdrop-blur-[1px]"><WebpIcon decorative name="play" size={24} state="white" /></span>
      </button> : null}
      {viewerState !== 'ready' ? <div aria-hidden="true" className="memoly-video-viewer-v2-placeholder"><WebpIcon decorative name="video" size={48} /></div> : null}
      <Typography as="span" className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-black/70 px-2 py-1 text-white" variant="memoryMeta">{formatDuration(durationMs)}</Typography>
    </div>
    {viewerState === 'loading' ? <div className="memoly-video-viewer-v2-status" role="status"><span className="memoly-video-viewer-v2-spinner" aria-hidden="true" /><Typography as="span" variant="memoryMeta">Загружаем видео…</Typography></div> : null}
    {viewerState === 'error' ? <div className="memoly-video-viewer-v2-error" role="alert"><Typography as="strong" variant="memoryBodyMedium">Не удалось загрузить видео</Typography><Typography as="span" variant="memoryMeta">Попробуйте открыть оригинал в MAX.</Typography></div> : null}
    {viewerState === 'error' && (onRetry || src) ? <Button className="memoly-video-viewer-v2-retry" onClick={() => { setPreviewReady(false); if (sourceFailed) onRetry?.(); else { setFailed(false); video.current?.load() } }} type="button">Повторить</Button> : null}
    <Button className="memoly-video-viewer-v2-open" onClick={onOpen} type="button" variant="outline">Открыть в MAX</Button>
  </div>
}

function useMaxVideoSource(path: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ path: string | null; status: 'loading' | 'ready' | 'error'; url: string | null }>({ path: null, status: 'loading', url: null })
  useEffect(() => {
    let cancelled = false
    if (!path) return () => { cancelled = true }
    void privateMediaSource(path).then((url) => {
      if (!cancelled) setState({ path, status: url ? 'ready' : 'error', url })
    }).catch(() => {
      if (!cancelled) setState({ path, status: 'error', url: null })
    })
    return () => { cancelled = true }
  }, [path, attempt])
  const current = !path ? { path, status: 'error' as const, url: null } : state.path === path ? state : { path, status: 'loading' as const, url: null }
  return { ...current, retry: () => { setState({ path: null, status: 'loading', url: null }); setAttempt((value) => value + 1) } }
}

function videoPosterAspectRatio(width: number | null, height: number | null) {
  return mediaAspectRatio(width, height) ?? '16 / 9'
}

function videoFrameStyle(width: number | null, height: number | null) {
  const validDimensions = Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
  const frameWidth = validDimensions ? width! : 16
  const frameHeight = validDimensions ? height! : 9
  return {
    aspectRatio: `${frameWidth} / ${frameHeight}`,
    marginInline: 'auto',
    width: `min(100%, calc(75dvh * ${frameWidth} / ${frameHeight}))`,
  }
}

function mediaAspectRatio(width: number | null, height: number | null) {
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
    ? `${width} / ${height}`
    : undefined
}

function PrivateImage({ attachment, hostBridge, photoAlbum, photoIndex, registerFullscreen, transport }: {
  attachment: Extract<MemoryAttachment, { source: 'private_storage' }>
  hostBridge: HostBridge
  photoAlbum: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex: number
  registerFullscreen?: (element: HTMLElement | null) => void
  transport: AuthenticatedTransport
}) {
  const path = attachment.displayPath ?? attachment.previewPath
  const url = usePrivateObjectUrl(path, transport)
  const [readyUrl, setReadyUrl] = useState<string | null>(null)
  const viewerSession = useRef<AbortController | null>(null)
  useEffect(() => () => { viewerSession.current?.abort() }, [])
  if (!url) return <div aria-label="Загрузка фотографии" className="w-full bg-muted" style={{ aspectRatio: mediaAspectRatio(attachment.width, attachment.height) ?? '16 / 9' }} />
  return <button aria-label="Открыть фото" className="ml-media-button block w-full" data-seen-ready={readyUrl === url} onClick={(event) => {
    viewerSession.current?.abort()
    const session = new AbortController()
    viewerSession.current = session
    void showPrivatePhotoAlbum(photoAlbum, photoIndex, transport, event.currentTarget, hostBridge, session.signal, registerFullscreen)
      .finally(() => { if (viewerSession.current === session) viewerSession.current = null })
  }} type="button"><PhotoImage alt="Воспоминание" height={attachment.height} onError={() => setReadyUrl(null)} onLoad={(event) => { const image = event.currentTarget; void image.decode().then(() => setReadyUrl(url)).catch(() => setReadyUrl(null)) }} src={url} width={attachment.width} /></button>
}

export function PhotoImage({ alt, height, onError, onLoad, src, width }: {
  alt: string
  height: number | null
  onError?: React.ReactEventHandler<HTMLImageElement>
  onLoad?: React.ReactEventHandler<HTMLImageElement>
  src: string
  width: number | null
}) {
  return <img alt={alt} className="block h-auto w-full" height={height ?? undefined} onError={onError} onLoad={onLoad} src={src} width={width ?? undefined} />
}

function AudioPlayer({ durationMs, path, waveform }: { durationMs: number | null; path: string | null; waveform: number[] | null }) {
  const { url } = usePrivateMediaSource(path)
  const audio = useRef<HTMLAudioElement | null>(null)
  const activate = usePlaybackRegistration(`audio:${path ?? 'missing'}`, audio)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(() => durationMs ? durationMs / 1_000 : 0)
  const updateDuration = (element: HTMLAudioElement) => { if (Number.isFinite(element.duration) && element.duration >= 0) setDuration(element.duration) }
  const syncCurrent = (element: HTMLAudioElement) => setCurrent(element.currentTime)
  return <div className="ml-audio p-4" data-seen-ready={Boolean(url)}><audio onDurationChange={(e) => updateDuration(e.currentTarget)} onEnded={(e) => { if (Number.isFinite(e.currentTarget.duration)) setCurrent(e.currentTarget.duration); setPlaying(false) }} onLoadedMetadata={(e) => updateDuration(e.currentTarget)} onPause={() => setPlaying(false)} onPlay={(e) => { activate(); syncCurrent(e.currentTarget) }} onSeeking={(e) => syncCurrent(e.currentTarget)} onTimeUpdate={(e) => syncCurrent(e.currentTarget)} preload="none" ref={audio} src={url ?? undefined} />
    <div className="flex items-center gap-3"><Button disabled={!url} onClick={() => void (async () => { const element = audio.current; if (!element) return; setPlaying(await toggleMediaPlayback(element)) })()} type="button">{playing ? 'Пауза' : 'Слушать'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {roundedSeconds(duration)}</Typography></div>
    <VoiceSeek current={current} duration={duration} onSeek={(position) => { if (audio.current) audio.current.currentTime = position; setCurrent(position) }} waveform={waveform} />
  </div>
}

function VoiceSeek({ current, duration, onSeek, waveform }: { current: number; duration: number; onSeek: (position: number) => void; waveform: number[] | null }) {
  if (!waveform || waveform.length !== 48) return <div className="mt-3"><input aria-label="Позиция голосового сообщения" className="w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.target.value))} step="0.1" type="range" value={current} /></div>
  const progress = voiceWaveformProgress(current, duration)
  return <div className="relative mt-3 flex h-10 items-center gap-px" data-slot="voice-waveform">
    {waveform.map((peak, index) => {
      const played = isVoiceWaveformPeakPlayed(index, waveform.length, progress)
      return <span aria-hidden="true" className="min-h-1 flex-1 rounded-full" data-waveform-peak="" data-waveform-played={played} key={index} style={{ backgroundColor: played ? 'var(--memory-accent-strong)' : 'var(--memory-line)', height: `${Math.max(10, Math.min(100, peak * 100))}%` }} />
    })}
    <div className="absolute inset-0 flex items-center opacity-0 focus-within:opacity-100"><input aria-label="Позиция голосового сообщения" className="w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.target.value))} step="0.1" type="range" value={current} /></div>
  </div>
}

function PrivateVideo({ path }: { path: string | null }) {
  const source = usePrivateMediaSource(path)
  const url = source.url
  const video = useRef<HTMLVideoElement | null>(null)
  const activate = usePlaybackRegistration(`video:${path ?? 'missing'}`, video)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const canFullscreen = typeof HTMLVideoElement !== 'undefined' && 'requestFullscreen' in HTMLVideoElement.prototype
  const viewerState = failed || source.status === 'error' ? 'error' : source.status
  return <div className="ml-video-row memoly-private-video-v2" data-seen-ready={viewerState === 'ready' && previewReady} data-video-viewer-state={viewerState}><div className="memoly-private-video-v2-frame"><video aria-label="Видео воспоминания" className="aspect-video w-full" onEnded={() => setPlaying(false)} onError={() => { setFailed(true); setPreviewReady(false) }} onLoadedData={() => setPreviewReady(true)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onPause={() => setPlaying(false)} onPlay={() => { setFailed(false); activate(); setPlaying(true) }} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} playsInline preload="metadata" ref={video} src={url ?? undefined} />
    {viewerState === 'loading' ? <Typography as="p" className="memoly-private-video-v2-state" role="status" variant="memoryMeta">Загружаем видео…</Typography> : null}
    {viewerState === 'error' ? <div className="memoly-private-video-v2-state" role="alert"><Typography as="p" variant="memoryBodyMedium">Не удалось загрузить видео</Typography>{path ? <Button onClick={() => { setFailed(false); source.retry(); video.current?.load() }} type="button">Повторить</Button> : null}</div> : null}</div>
    <div className="flex flex-wrap items-center gap-2 p-3"><Button disabled={!url} onClick={() => void (async () => { const element = video.current; if (!element) return; if (element.paused) { await element.play(); setPlaying(true) } else { element.pause(); setPlaying(false) } })()} type="button">{playing ? 'Пауза' : 'Смотреть'}</Button><Typography tone="muted" variant="memoryMeta">{seconds(current)} / {seconds(duration)}</Typography><Button disabled={!canFullscreen} onClick={() => void video.current?.requestFullscreen?.()} type="button">Полный экран</Button></div>
    <input aria-label="Позиция видео" className="mb-3 w-full px-3" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(e) => { if (video.current) video.current.currentTime = Number(e.target.value) }} step="0.1" type="range" value={current} />
  </div>
}

function MemoryDetail({ familyTimezone, hostBridge, memory, onClose, registerSeenContent, returnFocusRef, transport }: { familyTimezone: string; hostBridge: HostBridge; memory: MemoryDto; onClose: () => void; registerSeenContent?: (memoryId: string, layer: 'feed' | 'detail' | 'fullscreen') => (element: HTMLElement | null) => void; returnFocusRef: RefObject<HTMLElement | null>; transport: AuthenticatedTransport }) {
  const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> =>
    attachment.source === 'private_storage' && attachment.kind === 'photo')
  return <DialogPrimitive.Root onOpenChange={(open) => { if (!open) onClose() }} open>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className="fixed inset-0 z-50 flex items-end p-3 outline-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
        }}
      >
        <section className="memoly-detail-surface max-h-[90dvh] w-full overflow-y-auto rounded-[var(--radius-card)] bg-card p-5" data-memoly-feed>
          <div className="flex justify-between gap-3">
            <DialogPrimitive.Title asChild><Typography as="h2" variant="memoryHero">Воспоминание</Typography></DialogPrimitive.Title>
            <Button onClick={onClose} type="button">Закрыть</Button>
          </div>
          <DialogPrimitive.Description asChild><Typography className="mt-2" tone="muted" variant="memoryMeta">{dateTimeLabel(memory.occurredAt, familyTimezone)}</Typography></DialogPrimitive.Description>
          {memory.attachments.map((item, index) => <div className="mt-4" key={item.id} ref={index === 0 ? registerSeenContent?.(memory.id, 'detail') : undefined}><Attachment attachment={item} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={item.source === 'private_storage' && item.kind === 'photo' ? photos.findIndex((photo) => photo.id === item.id) : 0} registerFullscreen={registerSeenContent?.(memory.id, 'fullscreen')} transport={transport} /></div>)}
          {memory.body ? <div data-seen-ready={memory.kind === 'note' && memory.body.trim().length > 0 ? 'true' : undefined} ref={memory.attachments.length === 0 ? registerSeenContent?.(memory.id, 'detail') : undefined}><Typography className="mt-4 whitespace-pre-wrap" variant="memoryBody">{memory.body}</Typography></div> : null}
        </section>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

function usePrivateObjectUrl(path: string | null, transport?: AuthenticatedTransport) {
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!path || !transport) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    void transport.raw(path, { signal: controller.signal }).then(async (response) => {
      objectUrl = await responseToPrivateImageObjectUrl(response)
      if (controller.signal.aborted) URL.revokeObjectURL(objectUrl)
      else setLoaded({ path, url: objectUrl })
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ path, url: null }) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [path, transport])
  return loaded?.path === path ? loaded.url : null
}

function usePrivateMediaSource(path: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ path: string; status: 'ready' | 'error'; url: string | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!path) return
    void privateMediaSource(path).then((source) => { if (!cancelled) setLoaded({ path, status: source ? 'ready' : 'error', url: source }) }).catch(() => { if (!cancelled) setLoaded({ path, status: 'error', url: null }) })
    return () => { cancelled = true }
  }, [path, attempt])
  const current = !path ? { status: 'error' as const, url: null } : loaded?.path === path ? loaded : { status: 'loading' as const, url: null }
  return { ...current, retry: () => { setLoaded(null); setAttempt((value) => value + 1) } }
}

async function showPrivatePhotoAlbum(
  attachments: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>,
  index: number,
  transport: AuthenticatedTransport,
  trigger: HTMLButtonElement,
  hostBridge: HostBridge,
  signal: AbortSignal,
  registerFullscreen?: (element: HTMLElement | null) => void,
) {
  const scrollY = window.scrollY
  const slides: Array<{ src: string; width?: number; height?: number }> = []
  try {
    for (const attachment of attachments) {
      const path = attachment.displayPath ?? attachment.originalDownloadPath
      const response = await transport.raw(path, { signal })
      const src = await responseToPrivateImageObjectUrl(response)
      slides.push({
        src,
        width: attachment.width ?? undefined,
        height: attachment.height ?? undefined,
      })
      if (signal.aborted) return
    }
    await showPhoto(slides, index, hostBridge, signal, registerFullscreen)
  } finally {
    slides.forEach(({ src }) => URL.revokeObjectURL(src))
    window.scrollTo({ top: scrollY })
    if (trigger.isConnected) trigger.focus({ preventScroll: true })
  }
}

async function showPhoto(
  slides: Array<{ src: string; width?: number; height?: number }>,
  index: number,
  hostBridge: HostBridge,
  signal: AbortSignal,
  registerFullscreen?: (element: HTMLElement | null) => void,
) {
  const { default: PhotoSwipe } = await import('photoswipe')
  if (signal.aborted) return
  const gallery = new PhotoSwipe({ dataSource: slides, index, showHideAnimationType: 'none' })
  let closingFromHistory = false
  await new Promise<void>((resolve) => {
    let initialized = false
    let finished = false
    let activeImageToken = 0
    const registerCurrentImage = () => {
      activeImageToken += 1
      const token = activeImageToken
      registerFullscreen?.(null)
      const element = gallery.currSlide?.content.element
      if (!(element instanceof HTMLImageElement) || gallery.currSlide?.content.isError()) return
      element.dataset.seenReady = 'false'
      registerFullscreen?.(element)
      if (!element.complete || element.naturalWidth === 0) return
      void element.decode().then(() => {
        if (token === activeImageToken && !finished && gallery.currSlide?.content.element === element) element.dataset.seenReady = 'true'
      }).catch(() => { element.dataset.seenReady = 'false' })
    }
    const finish = () => {
      if (finished) return
      finished = true
      activeImageToken += 1
      registerFullscreen?.(null)
      window.removeEventListener('popstate', closeFromHistory)
      signal.removeEventListener('abort', closeFromUnmount)
      unsubscribeBack()
      if (!closingFromHistory && window.history.state?.privatePhotoViewer) window.history.back()
      resolve()
    }
    const closeFromHistory = () => {
      closingFromHistory = true
      gallery.close()
    }
    const closeFromUnmount = () => {
      if (initialized) gallery.destroy()
      else finish()
    }
    const unsubscribeBack = hostBridge.onBack(() => gallery.close())
    window.history.pushState({ privatePhotoViewer: true }, '')
    window.addEventListener('popstate', closeFromHistory, { once: true })
    signal.addEventListener('abort', closeFromUnmount, { once: true })
    gallery.on('destroy', finish)
    gallery.on('afterInit', registerCurrentImage)
    gallery.on('change', registerCurrentImage)
    gallery.on('loadComplete', registerCurrentImage)
    if (signal.aborted) {
      closeFromUnmount()
      return
    }
    gallery.init()
    initialized = true
  })
}

function dateTimeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) }
function dayLabel(value: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone })
  const calendar = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: timezone })
  const calendarDay = (date: Date) => {
    const parts = Object.fromEntries(calendar.formatToParts(date).map(({ type, value: part }) => [type, Number(part)]))
    return Date.UTC(parts.year!, parts.month! - 1, parts.day!) / 86_400_000
  }
  const occurred = new Date(value)
  const daysAgo = calendarDay(new Date()) - calendarDay(occurred)
  if (daysAgo === 0) return 'Сегодня'
  if (daysAgo === 1) return 'Вчера'
  return formatter.format(occurred)
}
function timeLabel(value: string, timezone: string) { return `${dayLabel(value, timezone)}, ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value))}` }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '•' }
function seconds(value: number) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00' }
function roundedSeconds(value: number) { return Number.isFinite(value) ? seconds(Math.round(value)) : '0:00' }
function formatDuration(value: number | null) { return value ? seconds(value / 1_000) : 'Длительность уточняется' }
