import { maxVideoPosterReadinessSchema, maxVideoReadinessSchema, type MaxVideoReadiness, type MemoryAttachment, type MemoryDto } from '@web-app-demo/contracts'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject, TouchEvent as ReactTouchEvent } from 'react'
import 'photoswipe/style.css'
import { Dialog as DialogPrimitive } from 'radix-ui'
import useEmblaCarousel from 'embla-carousel-react'

import { Button } from '@/components/ui/button'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { AuthContext } from '@/features/auth'
import { privateMediaSource } from '@/platform/media/private-media-access'
import { responseToPrivateImageObjectUrl } from '@/platform/media/private-image'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import { toggleAudioPlayback } from './audio-playback'
import type { HostBridge, TelegramInsets } from '@/platform/telegram'
import { requestReactionHaptic } from '@/platform/reaction-haptics'
import { loadFeed, loadMemory, openTelegramVideo } from './api'
import { navigateToTelegramVideo, useSingleFlightTelegramVideoHandoff } from './telegram-video-handoff'
import { EmptyState, FeedSkeleton, InlineError, type FeedFilter } from './components'
import { FeedPresentation, MemoryCardPresentation } from './presentation'
import { feedQueryKeys, useFeedQuery, useMemoryDelete, useMemoryReaction } from './queries'
import { refreshFromTop, shouldCheckForNew, shouldRefreshInitialEmptyFeed } from './live-refresh'
import { MediaPlaybackCoordinator } from './playback'
import { usePlaybackRegistration } from './use-playback-registration'
import { isVoiceWaveformPeakPlayed, voiceWaveformProgress } from './voice-waveform'
import { shouldRenderInitialFeedError } from '@/features/app'
import { useChildAvatar } from '@/features/family'
import { PwaInstallPrompt } from '@/features/pwa-install'
import { MemoryEditor, NoteComposer, PhotoComposer } from '@/features/composer'
import { AddSheetPresentation } from '@/features/memoly-ui'
import { VideoComposer } from '@/features/max-video-upload'
import { composerModeForAdd, type ComposerMode } from './composer-routing'
import { loadMaxVideoSourceOnce } from './max-video-source'
import { maxVideoPosterPath, maxVideoPosterReadinessInterval, maxVideoPosterReadinessPath, maxVideoReadinessInterval, maxVideoReadinessPath, withMaxVideoReadinessSlot } from './max-video-readiness'
import { hasPendingPrivateVideo, selectPendingPrivateVideoIds } from './pending-video-selection'
import { MemoryDeleteSpotlight } from './MemoryDeleteSpotlight'
import { useMemorySeenObserver } from './use-memory-seen-observer'
import { mediaCardSeenReady } from './seen-visibility'
import { VideoPlaybackControls } from './video-presentation'
import { FeedAuthorAvatar, FeedSharedAuthorAvatars } from './shared-author-avatars'
import { releaseVideoSource, useVideoViewportLifecycle } from './video-lifecycle'
import { getMediaFrameRatio, useMediaFrameRatio } from './media-ratio'
import { CommentsPanel, useCommentSummaries } from '@/features/comments'

type Props = {
  active?: boolean
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
  onAddRequestHandled?: () => void
  onFamily: () => void
  onOpenChild?: () => void
  onOpenSettings?: () => void
  onAllFamilies: () => void
  onFilterChange: (filter: FeedFilter) => void
  onAccessLost: () => void
  openAddInitially?: boolean
  role: 'full' | 'viewer'
  transport: AuthenticatedTransport
}

function pendingVideoQueryKey(familyId: string, accountId: string, membershipEpoch: number, memoryId: string) {
  return [...feedQueryKeys.all, familyId, 'video-rendition', accountId, membershipEpoch, memoryId] as const
}

const VideoQueryScope = createContext({ accountId: '', membershipEpoch: 0 })
const MAX_AUTO_PENDING_VIDEOS = 3
const MAX_AUTO_PENDING_SUCCESSES = 12

function withCurrentVideoRenditions(memory: MemoryDto, current: MemoryDto | undefined): MemoryDto {
  if (!current || current.id !== memory.id || current.familyId !== memory.familyId) return memory
  const latest = new Map(current.attachments.filter((attachment) => attachment.source === 'private_storage' && attachment.kind === 'video').map((attachment) => [attachment.id, attachment]))
  let changed = false
  const attachments = memory.attachments.map((attachment) => {
    if (attachment.source !== 'private_storage' || attachment.kind !== 'video') return attachment
    const update = latest.get(attachment.id)
    if (!update || update.source !== 'private_storage' || update.kind !== 'video') return attachment
    const renditionStatus = update.renditionStatus !== 'pending' ? update.renditionStatus : attachment.renditionStatus
    const previewPath = update.previewPath ?? attachment.previewPath
    const displayPath = update.displayPath ?? attachment.displayPath
    const playbackPath = update.playbackPath ?? attachment.playbackPath
    if (renditionStatus === attachment.renditionStatus && previewPath === attachment.previewPath && displayPath === attachment.displayPath && playbackPath === attachment.playbackPath) return attachment
    changed = true
    return { ...attachment, renditionStatus, previewPath, displayPath, playbackPath }
  })
  return changed ? { ...memory, attachments } : memory
}

export function FeedPage({
  active = true, accountId = '', childAvatarCrop = null, childAvatarMediaId = null, childId, childName, childSubtitle, familyId, familyName, familyTimezone, filter, hostBridge, insets, membershipEpoch = null, unreadCount = null, unreadState = 'not_enabled', onSeenCandidate, onFamily, onAllFamilies,
  isAppBootstrapped = true, maxVideoUploadAcceptance = false, onMaxVideoLaunchHandled, onAddRequestHandled, onAccessLost, onFilterChange, onOpenChild, onOpenSettings, role, transport,
  openAddInitially = false,
}: Props) {
  // `filter` remains in the route contract for compatibility; the feed now always includes every memory type.
  void filter
  const queryClient = useQueryClient()
  const childAvatarUrl = useChildAvatar(transport, familyId, childAvatarMediaId)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [unreadCycle, setUnreadCycle] = useState(0)
  const feed = useFeedQuery(transport, familyId, 'all', unreadOnly, accountId, membershipEpoch ?? 0, unreadOnly ? unreadCycle : 0, active)
  const { fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage } = feed
  const { refetch } = feed
  const reaction = useMemoryReaction(transport, familyId, accountId, membershipEpoch ?? 0)
  const [actionsMemory, setActionsMemory] = useState<MemoryDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MemoryDto | null>(null)
  const [deleteTargetIndex, setDeleteTargetIndex] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const deletion = useMemoryDelete(transport, familyId, () => undefined)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const [detail, setDetail] = useState<MemoryDto | null>(null)
  const [commentsSelection, setCommentsSelection] = useState<{ memoryId: string; familyId: string; accountId: string; membershipEpoch: number } | null>(null)
  const [reactionPickerRequest, setReactionPickerRequest] = useState<{ memoryId: string; revision: number }>({ memoryId: '', revision: 0 })
  const [mixedViewer, setMixedViewer] = useState<{ memory: MemoryDto; index: number; photoUrl?: string } | null>(null)
  const mixedIndexes = useRef(new Map<string, number>())
  const [, setMixedIndexRevision] = useState(0)
  const mixedPhotoUrls = useRef(new Map<string, string>())
  const detailReturnFocusRef = useRef<HTMLElement | null>(null)
  const [addSheetOpen, setAddSheetOpen] = useState(openAddInitially && role === 'full')
  const [composer, setComposer] = useState<ComposerMode | null>(maxVideoUploadAcceptance ? 'video' : null)
  const [editingMemory, setEditingMemory] = useState<MemoryDto | null>(null)
  const registerSeenContent = useMemorySeenObserver(active && Boolean(onSeenCandidate && membershipEpoch && unreadState !== 'not_enabled'), Boolean(detail || mixedViewer || addSheetOpen || actionsMemory || deleteTarget || commentsSelection), (id) => onSeenCandidate?.(id))
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const feedScope = useMemo(() => ({ familyId, filter: 'all' as const, unreadOnly, unreadCycle }), [familyId, unreadOnly, unreadCycle])
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
  const commentSummaries = useCommentSummaries(transport, familyId, accountId, membershipEpoch ?? 0, items.map((memory) => memory.id), active && isAppBootstrapped)
  const currentCommentsSelection = commentsSelection && commentsSelection.familyId === familyId && commentsSelection.accountId === accountId && commentsSelection.membershipEpoch === (membershipEpoch ?? 0) && items.some((memory) => memory.id === commentsSelection.memoryId) ? commentsSelection : null
  const commentsOpen = Boolean(active && currentCommentsSelection)
  const [nearbyPendingVideoIds, setNearbyPendingVideoIds] = useState<string[]>([])
  useEffect(() => {
    if (!active) return
    const pending = new Set(items.filter(hasPendingPrivateVideo).map((memory) => memory.id))
    if (pending.size === 0 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      setNearbyPendingVideoIds((current) => {
        const next = new Set(current.filter((id) => pending.has(id)))
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.memoryId
          if (!id || !pending.has(id)) continue
          if (entry.isIntersecting) next.add(id)
          else next.delete(id)
        }
        return current.length === next.size && current.every((id) => next.has(id)) ? current : [...next]
      })
    }, { rootMargin: '600px 0px' })
    document.querySelectorAll<HTMLElement>('.memory-card[data-memory-id]').forEach((card) => {
      if (pending.has(card.dataset.memoryId ?? '')) observer.observe(card)
    })
    return () => observer.disconnect()
  }, [active, items])
  const openedPendingMemories = [detail, mixedViewer?.memory].filter((memory): memory is MemoryDto => Boolean(memory))
  const pendingCandidates = new Set([...items.filter(hasPendingPrivateVideo), ...openedPendingMemories.filter(hasPendingPrivateVideo)].map((memory) => memory.id))
  const retiredPendingIds = new Set([...pendingCandidates].filter((id) => {
    const state = queryClient.getQueryState<MemoryDto>(pendingVideoQueryKey(familyId, accountId, membershipEpoch ?? 0, id))
    return Boolean(state && ((state.data?.id === id && state.data.familyId === familyId && !hasPendingPrivateVideo(state.data)) || state.dataUpdateCount >= MAX_AUTO_PENDING_SUCCESSES || state.errorUpdateCount >= 4))
  }))
  const pendingVideoIds = selectPendingPrivateVideoIds(items, openedPendingMemories, nearbyPendingVideoIds, MAX_AUTO_PENDING_VIDEOS, retiredPendingIds)
  useQueries({ queries: pendingVideoIds.map((memoryId) => ({
    queryKey: pendingVideoQueryKey(familyId, accountId, membershipEpoch ?? 0, memoryId),
    queryFn: ({ signal }: { signal: AbortSignal }) => loadMemory(transport, familyId, memoryId, signal),
    enabled: active && isAppBootstrapped,
    retry: false,
    refetchInterval: (query: { state: { data: MemoryDto | undefined; dataUpdateCount: number; errorUpdateCount: number } }) => {
      if (query.state.data && !hasPendingPrivateVideo(query.state.data)) return false
      if (query.state.dataUpdateCount >= MAX_AUTO_PENDING_SUCCESSES || query.state.errorUpdateCount >= 4) return false
      return 5_000 * 2 ** Math.min(query.state.errorUpdateCount, 3)
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  })) })
  const latestVideoMemories = new Map([...pendingCandidates].map((id) => [id, queryClient.getQueryData<MemoryDto>(pendingVideoQueryKey(familyId, accountId, membershipEpoch ?? 0, id))]))
  const renderedItems = items.map((memory) => withCurrentVideoRenditions(memory, latestVideoMemories.get(memory.id)))
  const visibleItems = (() => {
    if (!deleteTarget || renderedItems.some((memory) => memory.id === deleteTarget.id)) return renderedItems
    const next = [...renderedItems]
    const index = Math.max(0, Math.min(deleteTargetIndex ?? next.length, next.length))
    next.splice(index, 0, deleteTarget)
    return next
  })()
  const currentDetail = detail && withCurrentVideoRenditions(detail, renderedItems.find((memory) => memory.id === detail.id) ?? latestVideoMemories.get(detail.id))
  const currentMixedViewer = mixedViewer && { ...mixedViewer, memory: withCurrentVideoRenditions(mixedViewer.memory, renderedItems.find((memory) => memory.id === mixedViewer.memory.id) ?? latestVideoMemories.get(mixedViewer.memory.id)) }

  useEffect(() => {
    knownFirstId.current = null
  }, [familyId, accountId, membershipEpoch])

  useEffect(() => {
    // Reset transient selection when its private route scope changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCommentsSelection(null)
  }, [familyId, accountId, membershipEpoch, active])

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
    if (!active) return
    let checking = false
    let rerunRequested = false
    let disposed = false
    const checkForNew = async () => {
      if (checking && !document.hidden) { rerunRequested = true; return }
      if (!shouldCheckForNew({ checking, hidden: document.hidden })) return
      checking = true
      try {
        const latest = await loadFeed(transport, familyId, 'all', null)
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
  }, [active, familyId, feedScope, refetch, transport, unreadOnly])

  useEffect(() => {
    if (active) return
    document.querySelectorAll<HTMLMediaElement>('[data-memoly-feed] audio, [data-memoly-feed] video').forEach((element) => element.pause())
    document.dispatchEvent(new Event('memoly:feed-inactive'))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset transients after deactivation so they cannot reopen with the warm surface.
    setAddSheetOpen(false)
    setComposer(null)
    setEditingMemory(null)
    setDetail(null)
    setMixedViewer(null)
    setActionsMemory(null)
    setDeleteTarget(null)
    setDeleteTargetIndex(null)
    setDeleteError(null)
  }, [active])

  useEffect(() => {
    if (!active) return
    const target = sentinel.current
    if (!target || !hasNextPage) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
    }, { rootMargin: '320px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [active, fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage])

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
    if (!active || !deleteTarget) return undefined
    return hostBridge.onBack(() => {
      if (!deletion.isPending) cancelDelete()
    })
  }, [active, cancelDelete, deleteTarget, deletion.isPending, hostBridge])

  useEffect(() => {
    if (!active || !actionsMemory) return undefined
    return hostBridge.onBack(() => setActionsMemory(null))
  }, [active, actionsMemory, hostBridge])

  if (active && composer === 'video' && childId) {
    return <VideoComposer childId={childId} familyId={familyId} familyTimezone={familyTimezone} onCancel={() => { setComposer(null); onMaxVideoLaunchHandled?.() }} onSuccess={async () => { await closeComposerAfterRefresh(); onMaxVideoLaunchHandled?.() }} transport={transport} />
  }

  if (active && composer === 'photo' && childId) {
    return <PhotoComposer childId={childId} familyId={familyId} familyTimezone={familyTimezone} onCancel={() => setComposer(null)} onSuccess={closeComposerAfterRefresh} transport={transport} />
  }

  if (active && composer === 'note' && childId) {
    return <NoteComposer childId={childId} familyId={familyId} familyTimezone={familyTimezone} onCancel={() => setComposer(null)} onSuccess={closeComposerAfterRefresh} transport={transport} />
  }

  if (active && editingMemory) {
    return <MemoryEditor familyTimezone={familyTimezone} memory={editingMemory} onCancel={() => setEditingMemory(null)} onSuccess={closeComposerAfterRefresh} transport={transport} />
  }

  return (
    <VideoQueryScope.Provider value={{ accountId, membershipEpoch: membershipEpoch ?? 0 }}>
    <FeedSharedAuthorAvatars authors={visibleItems.map((memory) => ({ path: memory.publicationAttribution?.kind === 'channel' ? memory.publicationAttribution.avatarPath : memory.author.avatarPath }))} enabled={active && isAppBootstrapped && !feed.isPending && visibleItems.length > 0} familyId={familyId} membershipEpoch={membershipEpoch ?? 0} transport={transport} userId={accountId}>
    <MediaPlaybackCoordinator active={active && !commentsOpen}>
    <FeedPresentation activeFilter="all" childAvatarCrop={childAvatarCrop} childAvatarUrl={childAvatarUrl} childName={childName} childSubtitle={childSubtitle} familyName={familyName} insets={insets}
      addButtonRef={addButtonRef} onAdd={() => setAddSheetOpen(true)}
      onAllFamilies={onAllFamilies} onFamily={onFamily} onOpenChild={onOpenChild} onOpenSettings={onOpenSettings} onFeed={() => undefined} onFilterChange={() => { if (unreadOnly) setUnreadCycle((value) => value + 1); onFilterChange('all') }}
      onUnreadChange={(next) => { if (next && !unreadOnly) setUnreadCycle((value) => value + 1); setUnreadOnly(next) }}
      role={role} unreadCount={unreadCount} unreadOnly={unreadOnly} unreadState={unreadState}>
      {active && isAppBootstrapped ? <PwaInstallPrompt familyId={familyId} hostBridge={hostBridge} /> : null}
      {unreadOnly ? <div className="feed-unread-note"><Typography as="p" variant="memoryMeta">Просмотренные карточки останутся на месте до обновления списка.</Typography><Button onClick={() => { window.scrollTo({ top: 0, behavior: 'auto' }); setUnreadCycle((value) => value + 1) }} type="button" variant="outline">Обновить список</Button></div> : null}
      {newAvailable ? <div className="feed-new-available" role="status"><div><Typography as="span" variant="bodySm">Есть новые воспоминания</Typography>{refreshError ? <Typography as="p" role="alert" variant="bodySm">Не удалось обновить ленту. Повторите попытку.</Typography> : null}</div><Button onClick={() => { if (unreadOnly) { pendingNewRefresh.current = true; setUnreadOnly(false); setNewAvailableFor(null); return } void refreshFromTop(feed.refetch, knownFirstId, () => currentScope.current === feedScope, () => setNewAvailableFor(null)).then((success) => { if (currentScope.current === feedScope) setRefreshErrorFor(success ? null : feedScope) }) }} type="button">Показать новые</Button></div> : null}
      {!isAppBootstrapped || feed.isPending ? <FeedSkeleton /> : null}
      {shouldRenderInitialFeedError({ isAppBootstrapped, isFeedError: feed.isError, isFeedPending: feed.isPending, itemCount: items.length }) ? <InlineError onRetry={() => void feed.refetch()} /> : null}
      {isAppBootstrapped && !feed.isPending && !feed.isError && visibleItems.length === 0 ? unreadOnly
        ? <div className="feed-unread-empty" role="status"><Typography as="h2" variant="memoryEmptyTitle">Все новые воспоминания просмотрены</Typography><Typography as="p" variant="memoryBody">Новых воспоминаний пока нет.</Typography></div>
        : <EmptyState filtered={false} mode={role} onResetFilter={() => onFilterChange('all')} /> : null}
      {active && isAppBootstrapped && !feed.isPending && visibleItems.length > 0 ? <MemoryList familyTimezone={familyTimezone} items={visibleItems} renderCard={(memory) => {
        const primary = memory.attachments[0]
        const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> =>
          attachment.source === 'private_storage' && attachment.kind === 'photo')
        return <MemoryCardPresentation
          actions={<MemoryActions memory={memory} onOpen={(target, trigger) => { actionTriggerRef.current = trigger; setActionsMemory(target) }} />}
          isDeleteSource={deleteTarget?.id === memory.id}
          authorInitials={initials(memory.publicationAttribution?.name ?? memory.author.name)}
          authorName={memory.publicationAttribution?.name ?? memory.author.name}
          authorKind={memory.publicationAttribution?.kind ?? 'user'}
          authorAvatarPath={memory.publicationAttribution?.kind === 'channel' ? memory.publicationAttribution.avatarPath : memory.author.avatarPath}
          authorAvatarCrop={memory.publicationAttribution?.kind === 'channel' ? null : memory.author.avatarCrop}
          childName={memory.childId === childId ? childName : undefined}
          childAvatarUrl={memory.childId === childId ? childAvatarUrl : null}
          childAvatarCrop={memory.childId === childId ? childAvatarCrop : null}
          body={memory.body}
          kind={memory.kind}
          reactionCounts={memory.reactionCounts}
          currentUserReaction={memory.currentUserReaction}
          commentCount={commentSummaries.get(memory.id)}
          reactionPickerRequest={reactionPickerRequest.memoryId === memory.id ? reactionPickerRequest.revision : 0}
          onComments={(trigger) => {
            detailReturnFocusRef.current = trigger
            setCommentsSelection({ memoryId: memory.id, familyId, accountId, membershipEpoch: membershipEpoch ?? 0 })
          }}
          media={memory.kind === 'media' || (memory.kind === 'photo' && memory.attachments.length > 0)
            ? <MixedMediaCarousel hostBridge={hostBridge} initialIndex={mixedIndexes.current.get(memory.id) ?? 0} memory={memory} onIndexChange={(index) => mixedIndexes.current.set(memory.id, index)} onViewerIndexChange={(index) => { mixedIndexes.current.set(memory.id, index); detailReturnFocusRef.current = document.querySelector<HTMLElement>(`[data-carousel-memory="${memory.id}"] [data-carousel-position="${index + 1}"] button`); setMixedIndexRevision((value) => value + 1) }} onPhotoUrlChange={(attachmentId, url) => { const previousUrl = mixedPhotoUrls.current.get(attachmentId); if (url) mixedPhotoUrls.current.set(attachmentId, url); else mixedPhotoUrls.current.delete(attachmentId); setMixedViewer((current) => current?.memory.id === memory.id && current.memory.attachments[current.index]?.id === attachmentId && (current.photoUrl === previousUrl || !url) ? { ...current, photoUrl: url ?? undefined } : current) }} onOpen={(index, trigger, photoUrl) => { detailReturnFocusRef.current = trigger; setMixedViewer({ memory, index, photoUrl: photoUrl ?? mixedPhotoUrls.current.get(memory.attachments[index]?.id) }) }} registerFullscreen={memory.author.id !== accountId ? registerSeenContent(memory.id, 'fullscreen') : undefined} returnFocusRef={detailReturnFocusRef} transport={transport} />
            : primary ? <Attachment attachment={primary} hostBridge={hostBridge} memory={memory} photoAlbum={photos} photoIndex={0} registerFullscreen={memory.author.id !== accountId ? registerSeenContent(memory.id, 'fullscreen') : undefined} transport={transport} /> : null}
          memoryId={memory.id}
          reactionScopeKey={`${familyId}:${accountId}:${membershipEpoch ?? 0}`}
          seenContentRef={memory.author.id !== accountId ? registerSeenContent(memory.id, 'feed') : undefined}
          occurredTime={timeLabel(memory.occurredAt, familyTimezone)}
          onReaction={(next) => reaction.setReaction(memory.id, next)}
          onReactionFeedback={(style) => requestReactionHaptic(hostBridge, style)}
          onOpen={() => { detailReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; if (memory.kind === 'media' || (memory.kind === 'photo' && memory.attachments.length > 1)) { const index = mixedIndexes.current.get(memory.id) ?? 0; setMixedViewer({ memory, index, photoUrl: mixedPhotoUrls.current.get(memory.attachments[index]?.id) }) } else setDetail(memory) }}
        />
      }} /> : null}
      <div aria-hidden="true" data-testid="feed-load-more-sentinel" ref={sentinel} />
      {feed.isFetchingNextPage ? <FeedSkeleton /> : null}
      {feed.isFetchNextPageError && items.length > 0 ? unreadOnly && feed.error instanceof ApiRequestError && feed.error.status === 409
        ? <div className="feed-unread-restart" role="status"><Typography as="p" variant="memoryMeta">Список изменился. Обновите непросмотренные, чтобы продолжить.</Typography><Button onClick={() => { window.scrollTo({ top: 0, behavior: 'instant' }); setUnreadCycle((value) => value + 1) }} type="button">Обновить список</Button></div>
        : <InlineError nextPage onRetry={() => void feed.fetchNextPage()} /> : null}
      {active && currentDetail ? <MemoryDetail familyTimezone={familyTimezone} hostBridge={hostBridge} memory={currentDetail} onClose={() => setDetail(null)} registerSeenContent={currentDetail.author.id !== accountId ? registerSeenContent : undefined} returnFocusRef={detailReturnFocusRef} transport={transport} /> : null}
      {active && currentMixedViewer ? <MixedMediaViewer familyTimezone={familyTimezone} hostBridge={hostBridge} index={currentMixedViewer.index} initialPhotoUrl={currentMixedViewer.photoUrl} memory={currentMixedViewer.memory} onClose={() => setMixedViewer(null)} onIndexChange={(index) => { mixedIndexes.current.set(currentMixedViewer.memory.id, index); detailReturnFocusRef.current = document.querySelector<HTMLElement>(`[data-carousel-memory="${currentMixedViewer.memory.id}"] [data-carousel-position="${index + 1}"] button`); setMixedIndexRevision((value) => value + 1) }} registerSeenContent={currentMixedViewer.memory.author.id !== accountId ? registerSeenContent(currentMixedViewer.memory.id, 'fullscreen') : undefined} returnFocusRef={detailReturnFocusRef} transport={transport} /> : null}
      {commentsOpen && currentCommentsSelection ? <CommentsPanel familyTimezone={familyTimezone} hostBridge={hostBridge} onClose={() => setCommentsSelection(null)} open scope={currentCommentsSelection} transport={transport} returnFocusRef={detailReturnFocusRef} hostInsets={insets} /> : null}
    </FeedPresentation>
    <AddSheetPresentation
      hostBridge={hostBridge}
      onNote={() => { const next = composerModeForAdd('note', childId); if (next) setComposer(next) }}
      onOpenChange={(open) => { setAddSheetOpen(open); if (!open) onAddRequestHandled?.() }}
      onPhoto={() => { const next = composerModeForAdd('photo', childId); if (next) setComposer(next) }}
      onVideo={() => { const next = composerModeForAdd('video', childId); if (next) setComposer(next) }}
      open={active && (addSheetOpen || openAddInitially && role === 'full')}
      returnFocusRef={addButtonRef}
      role={role}
    />
    <MemolyBottomSheet
      onOpenChange={(open) => { if (!open) setActionsMemory(null) }}
      open={active && actionsMemory !== null}
      returnFocusRef={actionTriggerRef}
    >
      {actionsMemory ? (
        <MemoryActionsContent
          memory={actionsMemory}
          onChooseReaction={() => { const memoryId = actionsMemory.id; setActionsMemory(null); setReactionPickerRequest((current) => ({ memoryId, revision: current.revision + 1 })) }}
          onDelete={actionsMemory.capabilities.delete ? () => {
            setActionsMemory(null)
            setDeleteError(null)
            setDeleteTargetIndex(items.findIndex((item) => item.id === actionsMemory.id))
            setDeleteTarget(actionsMemory)
          } : undefined}
          onDetails={() => { detailReturnFocusRef.current = actionTriggerRef.current; setActionsMemory(null); if (actionsMemory.kind === 'media' || (actionsMemory.kind === 'photo' && actionsMemory.attachments.length > 1)) { const index = mixedIndexes.current.get(actionsMemory.id) ?? 0; setMixedViewer({ memory: actionsMemory, index, photoUrl: mixedPhotoUrls.current.get(actionsMemory.attachments[index]?.id) }) } else setDetail(actionsMemory) }}
          onEdit={actionsMemory.capabilities.edit ? () => { setActionsMemory(null); setEditingMemory(actionsMemory) } : undefined}
        />
      ) : null}
    </MemolyBottomSheet>
    <MemoryDeleteSpotlight
      error={deleteError}
      memory={active ? deleteTarget : null}
      onCancel={cancelDelete}
      onConfirm={() => {
        if (!deleteTarget || deletion.isPending) return
        setDeleteError(null)
        void deletion.mutateAsync({ memoryId: deleteTarget.id, version: deleteTarget.version })
          .then(() => { setDeleteTarget(null); setDeleteTargetIndex(null); setDeleteError(null) })
          .catch(() => { setDeleteError('Не удалось удалить воспоминание. Попробуйте ещё раз.') })
      }}
      open={active && deleteTarget !== null}
      preview={deleteTarget ? <MemoryDeletePreview familyTimezone={familyTimezone} memory={deleteTarget} transport={transport} /> : null}
      submitting={deletion.isPending}
    />
    </MediaPlaybackCoordinator>
    </FeedSharedAuthorAvatars>
    </VideoQueryScope.Provider>
  )
}

function MixedMediaCarousel({ hostBridge, initialIndex, memory, onIndexChange, onViewerIndexChange, onPhotoUrlChange, onOpen, registerFullscreen, returnFocusRef, transport }: {
  hostBridge: HostBridge
  initialIndex: number
  memory: MemoryDto
  onIndexChange: (index: number) => void
  onViewerIndexChange: (index: number) => void
  onPhotoUrlChange: (attachmentId: string, url: string | null) => void
  onOpen: (index: number, trigger: HTMLElement, photoUrl?: string) => void
  registerFullscreen?: (element: HTMLElement | null) => void
  returnFocusRef: RefObject<HTMLElement | null>
  transport: AuthenticatedTransport
}) {
  const [startIndex] = useState(() => Math.max(0, Math.min(initialIndex, memory.attachments.length - 1)))
  const reportInitialIndex = useEffectEvent(() => onIndexChange(startIndex))
  const onIndexChangeRef = useRef(onIndexChange)
  useEffect(() => { onIndexChangeRef.current = onIndexChange }, [onIndexChange])
  const [viewportRef, embla] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    startIndex,
    watchResize: (_api, entries) => entries.every((entry) => {
      const element = entry.target
      return element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
    }),
  })
  const [index, setIndex] = useState(startIndex)
  const [settledIndex, setSettledIndex] = useState(startIndex)
  const isCarousel = memory.attachments.length > 1
  const mediaFrameRatio = useMediaFrameRatio(memory.id, memory.attachments)
  const [photoViewerError, setPhotoViewerError] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const photoViewerSession = useRef<AbortController | null>(null)
  const latestIndex = useRef(startIndex)
  useEffect(() => { reportInitialIndex() }, [startIndex])
  useEffect(() => {
    if (!embla || embla.selectedScrollSnap() === initialIndex) return
    embla.scrollTo(Math.max(0, Math.min(initialIndex, memory.attachments.length - 1)))
  }, [embla, initialIndex, memory.attachments.length])
  useLayoutEffect(() => {
    const target = root.current?.querySelector<HTMLElement>(`[data-carousel-position="${index + 1}"] button`)
    if (target) returnFocusRef.current = target
  }, [index, returnFocusRef])
  useEffect(() => {
    const closeViewer = () => photoViewerSession.current?.abort()
    document.addEventListener('memoly:feed-inactive', closeViewer)
    return () => {
      document.removeEventListener('memoly:feed-inactive', closeViewer)
      closeViewer()
    }
  }, [])
  const select = useCallback(() => {
    if (!embla) return
    const next = embla.selectedScrollSnap()
    latestIndex.current = next
    root.current?.querySelectorAll('video').forEach((video) => video.pause())
    setIndex(next)
    onIndexChangeRef.current(next)
    window.__MEMOLY_DIAGNOSTICS__?.record('carousel-selection', 'mounted')
  }, [embla])
  useEffect(() => {
    if (!embla) return
    embla.on('select', select)
    const settle = () => setSettledIndex(latestIndex.current)
    embla.on('settle', settle)
    return () => { embla.off('select', select); embla.off('settle', settle) }
  }, [embla, select])
  const open = (at: number, trigger: HTMLElement, photoUrl?: string) => {
    returnFocusRef.current = trigger
    root.current?.querySelectorAll('video').forEach((video) => video.pause())
    if (memory.kind === 'photo') {
      photoViewerSession.current?.abort()
      const session = new AbortController()
      photoViewerSession.current = session
      setPhotoViewerError(false)
      const photos = memory.attachments.filter((attachment): attachment is Extract<MemoryAttachment, { source: 'private_storage' }> => attachment.source === 'private_storage' && attachment.kind === 'photo')
      void showPrivatePhotoAlbum(photos, at, transport, trigger, hostBridge, session.signal, registerFullscreen, onViewerIndexChange, returnFocusRef, memory.body)
        .catch(() => { if (!session.signal.aborted && photoViewerSession.current === session) setPhotoViewerError(true) })
        .finally(() => { if (photoViewerSession.current === session) photoViewerSession.current = null })
      return
    }
    onOpen(at, trigger, photoUrl)
  }
  return <div aria-label={`Медиа воспоминания, ${memory.attachments.length} элементов`} className="memoly-mixed-carousel" data-carousel-memory={memory.id} data-carousel-multiple={isCarousel} data-seen-active-index={index} onKeyDown={(event) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); embla?.scrollPrev() }
    if (event.key === 'ArrowRight' && index < memory.attachments.length - 1) { event.preventDefault(); embla?.scrollNext() }
  }} ref={root} role="group" tabIndex={0}>
    <div className="memoly-mixed-viewport" data-media-stage={isCarousel ? 'feed' : undefined} ref={viewportRef} style={{ '--memoly-active-media-aspect': mediaFrameRatio, '--memoly-carousel-aspect': mediaFrameRatio } as CSSProperties}>
      <div className="memoly-mixed-track">
        {memory.attachments.map((attachment, position) => <div aria-hidden={position !== index} aria-label={position === index ? `${position + 1} из ${memory.attachments.length}, ${attachment.kind === 'photo' ? 'фото' : 'видео'}` : undefined} className="memoly-mixed-slide" data-carousel-active={position === index} data-carousel-position={position + 1} data-media-kind={attachment.kind} inert={position !== index} key={attachment.id} role={position === index ? 'group' : undefined}>
          {position === index || position === settledIndex || (Math.abs(position - index) === 1 && (attachment.kind === 'photo' || attachment.kind === 'video'))
            ? <MixedSlideMedia attachment={attachment} hostBridge={hostBridge} memory={memory} multi={isCarousel} onOpen={(trigger, photoUrl) => open(position, trigger, photoUrl)} onPhotoUrlChange={onPhotoUrlChange} transport={transport} />
            : <span aria-hidden="true" className="memoly-mixed-placeholder" />}
        </div>)}
      </div>
      {isCarousel ? <Typography as="span" aria-label={`${index + 1} из ${memory.attachments.length}`} className="memoly-mixed-count" variant="memoryMeta">{index + 1} / {memory.attachments.length}</Typography> : null}
      {isCarousel ? <Typography as="span" aria-live="polite" className="sr-only" variant="memoryMeta">{index + 1} из {memory.attachments.length}</Typography> : null}
    </div>
    {memory.attachments.length > 1 ? <div className="memoly-mixed-controls">
      <div aria-label={`Положение карусели: ${index + 1} из ${memory.attachments.length}`} className="memoly-mixed-dots" role="group">
        <Typography as="span" className="sr-only" variant="memoryMeta">{index + 1} из {memory.attachments.length}</Typography>
        {memory.attachments.map((attachment, position) => <button aria-label={`Показать вложение ${position + 1} из ${memory.attachments.length}`} aria-pressed={position === index} className={position === index ? 'active' : ''} data-carousel-dot={position + 1} key={attachment.id} onClick={() => embla?.scrollTo(position)} type="button" />)}
      </div>
    </div> : null}
    {photoViewerError ? <Typography as="p" className="memoly-photo-viewer-error" role="alert" variant="memoryMeta">Не удалось открыть фото. Попробуйте ещё раз.</Typography> : null}
  </div>
}

function MixedSlideMedia({ attachment, hostBridge, memory, multi, onOpen, onPhotoUrlChange, transport }: { attachment: MemoryAttachment; hostBridge: HostBridge; memory: MemoryDto; multi: boolean; onOpen: (trigger: HTMLElement, photoUrl?: string) => void; onPhotoUrlChange: (attachmentId: string, url: string | null) => void; transport: AuthenticatedTransport }) {
  const root = useRef<HTMLDivElement | null>(null)
  const { accountId, membershipEpoch } = useContext(VideoQueryScope)
  const posterReadinessPath = attachment.source === 'max' && attachment.posterState === 'pending' ? maxVideoPosterReadinessPath(attachment.playbackPath) : null
  const posterReadinessKey = [...feedQueryKeys.all, 'max-video-poster-readiness', accountId, membershipEpoch, posterReadinessPath] as const
  const posterReadiness = useQuery({
    queryKey: posterReadinessKey,
    queryFn: ({ signal }) => withMaxVideoReadinessSlot(signal, () => transport.request(posterReadinessPath!, maxVideoPosterReadinessSchema, { signal })),
    enabled: multi && Boolean(posterReadinessPath),
    refetchInterval: (query) => maxVideoPosterReadinessInterval(query.state),
    refetchIntervalInBackground: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  const videoPoster = multi && attachment.kind === 'video' ? attachment.source === 'private_storage' ? attachment.displayPath ?? attachment.previewPath : attachment.source === 'telegram' ? attachment.thumbnailPath : attachment.posterState === 'ready' ? attachment.posterPath ?? null : attachment.posterState === 'pending' ? posterReadiness.data?.state === 'ready' ? posterReadiness.data.posterPath : null : maxVideoPosterPath(attachment.playbackPath) : null
  const posterUrl = usePrivateObjectUrl(videoPoster, transport)
  useEffect(() => () => { root.current?.querySelectorAll('video').forEach((video) => video.pause()) }, [])
  if (multi && attachment.kind === 'video') return <div className="memoly-mixed-slide-media memoly-mixed-slide-poster" data-poster-ready={Boolean(posterUrl)}><button aria-label={`Открыть видео, вложение ${attachment.id}`} onClick={(event) => onOpen(event.currentTarget)} style={{ aspectRatio: mediaAspectRatio(attachment.width, attachment.height) ?? '16 / 9' }} type="button">{posterUrl ? <img alt="Кадр видео" src={posterUrl} /> : <Typography as="span" className="memoly-carousel-video-loading" variant="memoryMeta">Загружаем кадр видео…</Typography>}<span aria-hidden="true" className="memoly-carousel-video-play"><WebpIcon decorative name="play" size={24} state="white" /></span></button></div>
  return <div className="memoly-mixed-slide-media" ref={root}><Attachment attachment={attachment} hostBridge={hostBridge} memory={memory} onOpenPhoto={onOpen} onPhotoUrlChange={onPhotoUrlChange} transport={transport} /></div>
}

function MixedMediaViewer({ familyTimezone, hostBridge, index: initialIndex, initialPhotoUrl, memory, onClose, onIndexChange, registerSeenContent, returnFocusRef, transport }: { familyTimezone: string; hostBridge: HostBridge; index: number; initialPhotoUrl?: string; memory: MemoryDto; onClose: () => void; onIndexChange: (index: number) => void; registerSeenContent?: (element: HTMLElement | null) => void; returnFocusRef: RefObject<HTMLElement | null>; transport: AuthenticatedTransport }) {
  const [index, setIndex] = useState(initialIndex)
  const media = memory.attachments[index]
  const attribution = memory.publicationAttribution
  const authorName = attribution?.name ?? memory.author.name
  const isChannelAuthor = attribution?.kind === 'channel'
  const authorAvatarPath = attribution?.kind === 'channel' ? attribution.avatarPath : memory.author.avatarPath
  const authorAvatarCrop = isChannelAuthor ? null : memory.author.avatarCrop
  const authorAvatarFallback = isChannelAuthor
    ? <span aria-hidden="true" className="author-avatar publication-channel-avatar"><WebpIcon decorative name="channel" size={22} /></span>
    : <span aria-hidden="true" className="author-avatar"><Typography as="span" className="author-initials" variant="memoryMeta">{initials(authorName)}</Typography></span>
  const root = useRef<HTMLDivElement | null>(null)
  const swipeStart = useRef<{ id: number; x: number; y: number; axis: 'undecided' | 'horizontal' | 'vertical' | 'cancelled'; direction: -1 | 1 | null } | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => () => { root.current?.querySelectorAll('video').forEach((video) => video.pause()) }, [])
  const navigate = (next: number) => {
    if (next < 0 || next >= memory.attachments.length) return
    swipeStart.current = null
    root.current?.querySelectorAll('video').forEach((video) => video.pause())
    setIndex(next)
    onIndexChange(next)
  }
  const onMediaTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const target = event.target
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1 || !(target instanceof Element) || target.closest('button, input, select, textarea, a, [role="slider"]') || target.closest('video[controls]')) {
      swipeStart.current = null
      return
    }
    const touch = event.touches[0]
    swipeStart.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: 'undecided', direction: null }
  }
  const onMediaTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    if (!start) return
    if (event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1 || event.touches[0].identifier !== start.id) {
      start.axis = 'cancelled'
      return
    }
    const dx = event.touches[0].clientX - start.x
    const dy = event.touches[0].clientY - start.y
    if (start.axis === 'undecided') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= 12) return
      if (Math.abs(dx) >= Math.abs(dy) * 1.25) { start.axis = 'horizontal'; start.direction = dx < 0 ? -1 : 1 }
      else if (Math.abs(dy) >= Math.abs(dx) * 1.25) { start.axis = 'vertical'; start.direction = dy < 0 ? -1 : 1 }
      else start.axis = 'cancelled'
      return
    }
    const primary = start.axis === 'horizontal' ? dx : dy
    const cross = start.axis === 'horizontal' ? dy : dx
    if (start.axis === 'cancelled' || (start.direction !== null && primary * start.direction < -8) || Math.abs(cross) > Math.abs(primary) * 1.25) start.axis = 'cancelled'
  }
  const onMediaTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start || start.axis === 'cancelled' || (window.visualViewport?.scale ?? 1) > 1 || event.touches.length !== 0 || event.changedTouches.length !== 1 || event.changedTouches[0].identifier !== start.id) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (start.axis === 'horizontal' && start.direction !== null && Math.abs(dx) >= 48 && Math.abs(dx) >= Math.abs(dy) * 1.3 && Math.sign(dx) === start.direction) navigate(index - start.direction)
    if (media.kind === 'photo' && start.axis === 'vertical' && start.direction === 1 && dy >= 96 && dy >= Math.abs(dx) * 1.3) onCloseRef.current()
  }
  useEffect(() => {
    const close = () => onCloseRef.current()
    const onPopState = () => close()
    const unsubscribeBack = hostBridge.onBack(close)
    window.history.pushState({ ...(window.history.state ?? {}), mixedMediaViewer: true }, '')
    window.addEventListener('popstate', onPopState, { once: true })
    return () => {
      window.removeEventListener('popstate', onPopState)
      unsubscribeBack()
      if (window.history.state?.mixedMediaViewer) window.history.back()
    }
  }, [hostBridge])
  return <DialogPrimitive.Root onOpenChange={(open) => { if (!open) onClose() }} open>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="memoly-mixed-viewer-overlay" />
      <DialogPrimitive.Content aria-describedby={undefined} className="memoly-mixed-viewer" data-memoly-feed data-mixed-viewer="" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }} onKeyDown={(event) => { if (event.target instanceof HTMLInputElement && event.target.type === 'range') return; if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(index - 1) } if (event.key === 'ArrowRight') { event.preventDefault(); navigate(index + 1) } }} ref={root}>
        <DialogPrimitive.Title className="sr-only">Медиа воспоминания</DialogPrimitive.Title>
        <div className="memoly-mixed-viewer-bar">
          <div className="memoly-viewer-author">
            <FeedAuthorAvatar avatarPath={authorAvatarPath} avatarCrop={authorAvatarCrop} className={`author-avatar${isChannelAuthor ? ' publication-channel-avatar' : ''}`} name={authorName} fallback={authorAvatarFallback} />
            <div className="memoly-viewer-author-copy">
              <Typography as="span" variant="memoryMeta">{authorName}</Typography>
              <Typography as="span" variant="memoryMeta">{timeLabel(memory.occurredAt, familyTimezone)}</Typography>
            </div>
          </div>
          <Typography as="span" className="memoly-viewer-count" variant="memoryMeta">{index + 1} / {memory.attachments.length}</Typography>
          <button aria-label="Закрыть просмотр" className="memoly-viewer-close" onClick={onClose} type="button">
            <Typography as="span" aria-hidden="true" className="memoly-viewer-close-glyph" variant="memoryMeta">×</Typography>
          </button>
        </div>
        <div aria-label={`${index + 1} из ${memory.attachments.length}`} className="memoly-mixed-viewer-media" data-media-kind={media.kind} data-seen-active-index={index} onTouchCancel={() => { swipeStart.current = null }} onTouchEnd={onMediaTouchEnd} onTouchMove={onMediaTouchMove} onTouchStart={onMediaTouchStart} role="group" key={media.id} ref={registerSeenContent}><div data-carousel-active="true"><Attachment attachment={media} autoplay={index === initialIndex && media.kind === 'video'} borrowedPhotoUrl={index === initialIndex ? initialPhotoUrl : undefined} fullscreen hostBridge={hostBridge} memory={memory} photoInteractive={false} transport={transport} /></div></div>
        {memory.body.trim() ? <Typography className="memoly-viewer-caption" variant="memoryMeta">{memory.body}</Typography> : null}
        {memory.attachments.length > 1 ? <div aria-label="Вложения воспоминания" className="memoly-viewer-thumbnails">{memory.attachments.map((attachment, thumbnailIndex) => <ViewerThumbnail attachment={attachment} index={thumbnailIndex + 1} total={memory.attachments.length} key={attachment.id} active={thumbnailIndex === index} onSelect={() => navigate(thumbnailIndex)} transport={transport} />)}</div> : null}
        <div className="memoly-mixed-viewer-nav"><button disabled={index === 0} onClick={() => navigate(index - 1)} type="button"><Typography as="span" variant="memoryMeta">Назад</Typography></button><button disabled={index === memory.attachments.length - 1} onClick={() => navigate(index + 1)} type="button"><Typography as="span" variant="memoryMeta">Далее</Typography></button></div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

function ViewerThumbnail({ attachment, active, index, onSelect, total, transport }: { attachment: MemoryAttachment; active: boolean; index: number; onSelect: () => void; total: number; transport: AuthenticatedTransport }) {
  const previewPath = attachment.source === 'private_storage'
    ? attachment.kind === 'photo' ? attachment.previewPath ?? attachment.displayPath : attachment.kind === 'video' ? attachment.previewPath ?? attachment.displayPath : null
    : attachment.source === 'telegram' ? attachment.thumbnailPath
      : attachment.posterState === 'ready' ? attachment.posterPath : null
  const url = usePrivateObjectUrl(previewPath ?? null, transport)
  return <button aria-label={`Перейти к вложению ${index} из ${total}`} aria-pressed={active} className="memoly-viewer-thumbnail" onClick={onSelect} type="button">{url ? <img alt="" src={url} /> : <span aria-hidden="true">{attachment.kind === 'video' ? <WebpIcon decorative monochrome name="video" size={18} /> : <Typography as="span" variant="memoryMeta">Фото</Typography>}</span>}</button>
}

function Attachment({ attachment, autoplay = false, borrowedPhotoUrl, fullscreen = false, hostBridge, memory, photoAlbum = [], photoIndex = 0, registerFullscreen, onOpenPhoto, onPhotoUrlChange, photoInteractive = true, transport }: {
  attachment: MemoryAttachment
  autoplay?: boolean
  borrowedPhotoUrl?: string
  fullscreen?: boolean
  hostBridge: HostBridge
  memory: MemoryDto
  photoAlbum?: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex?: number
  registerFullscreen?: (element: HTMLElement | null) => void
  onOpenPhoto?: (trigger: HTMLElement, photoUrl: string) => void
  onPhotoUrlChange?: (attachmentId: string, url: string | null) => void
  photoInteractive?: boolean
  transport: AuthenticatedTransport
}) {
  if (attachment.source === 'telegram') return <TelegramVideo attachment={attachment} familyId={memory.familyId} hostBridge={hostBridge} memoryId={memory.id} transport={transport} />
  if (attachment.source === 'max') return <MaxVideo attachment={attachment} autoplay={autoplay} fullscreen={fullscreen} hostBridge={hostBridge} transport={transport} />
  if (attachment.kind === 'photo') return <PrivateImage attachment={attachment} borrowedUrl={borrowedPhotoUrl} caption={memory.body} hostBridge={hostBridge} onOpenPhoto={onOpenPhoto} onUrlChange={onPhotoUrlChange} photoAlbum={photoAlbum.length > 0 ? photoAlbum : [attachment]} photoIndex={photoIndex} registerFullscreen={registerFullscreen} interactive={photoInteractive} transport={transport} />
  if (attachment.kind === 'voice') return <AudioPlayer durationMs={attachment.durationMs} path={attachment.playbackPath} waveform={attachment.waveform} />
  return <PrivateVideo attachment={attachment} autoplay={autoplay} fullscreen={fullscreen} memory={memory} transport={transport} />
}

export function TelegramVideo({ attachment, familyId, hostBridge, memoryId, transport }: { attachment: Extract<MemoryAttachment, { source: 'telegram' }>; familyId: string; hostBridge: HostBridge; memoryId: string; transport: AuthenticatedTransport }) {
  const frameRatio = useMediaFrameRatio(memoryId, [attachment])
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
    <TelegramVideoPoster busy={busy} disabled={busy} durationMs={attachment.durationMs} frameRatio={frameRatio} height={attachment.height} onOpen={openHandoff} onPosterReady={setPosterReadyUrl} posterReady={Boolean(posterUrl && posterReadyUrl === posterUrl)} posterUrl={posterUrl} width={attachment.width} />
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

function MemoryActionsContent({ memory, onDelete, onDetails, onEdit, onChooseReaction }: { memory: MemoryDto; onDelete?: () => void; onDetails: () => void; onEdit?: () => void; onChooseReaction: () => void }) {
  return <div className="memoly-memory-actions" data-memory-actions-for={memory.id}>
    <DrawerTitle className="sr-only">Действия с воспоминанием</DrawerTitle>
    <DrawerDescription className="sr-only">Выберите действие для этого воспоминания.</DrawerDescription>
    <div className="memoly-memory-actions-list">
      <button aria-label="Выбрать или изменить реакцию" className="memoly-memory-action" onClick={onChooseReaction} type="button">
        <span className="memoly-memory-action-icon"><WebpIcon decorative monochrome name="heart" size={18} /></span>
        <span className="memoly-memory-action-copy"><Typography as="span" className="memoly-memory-action-title" variant="memoryBody">Выбрать или изменить реакцию</Typography><Typography as="span" className="memoly-memory-action-subtitle" variant="memoryMeta">Откликнуться на воспоминание</Typography></span>
        <span className="memoly-memory-action-chevron"><WebpIcon decorative name="chevron" size={16} /></span>
      </button>
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
      authorInitials={initials(memory.publicationAttribution?.name ?? memory.author.name)}
      authorName={memory.publicationAttribution?.name ?? memory.author.name}
      authorKind={memory.publicationAttribution?.kind ?? 'user'}
      authorAvatarPath={memory.publicationAttribution?.kind === 'channel' ? memory.publicationAttribution.avatarPath : memory.author.avatarPath}
      authorAvatarCrop={memory.publicationAttribution?.kind === 'channel' ? null : memory.author.avatarCrop}
      body={memory.body}
      kind={memory.kind}
      reactionCounts={memory.reactionCounts}
      currentUserReaction={memory.currentUserReaction}
      media={primary ? <MemoryDeletePreviewMedia attachment={primary} transport={transport} /> : null}
      memoryId={memory.id}
      mode="delete-preview"
      occurredTime={timeLabel(memory.occurredAt, familyTimezone)}
      onReaction={() => undefined}
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

export function TelegramVideoPoster({ durationMs, frameRatio, posterUrl, posterReady = false, onPosterReady, width, height, onOpen = () => undefined, disabled = false, busy = false }: {
  frameRatio?: number
  durationMs: number | null; posterUrl: string | null; width: number | null; height: number | null
  onOpen?: () => void; onPosterReady?: (url: string | null) => void; posterReady?: boolean; disabled?: boolean; busy?: boolean
}) {
  const aspectRatio = frameRatio ?? videoPosterAspectRatio(width, height)
  return <button aria-label="Смотреть видео в Telegram" className="relative isolate block w-full overflow-hidden bg-muted text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-60" data-seen-ready={posterReady} disabled={disabled} onClick={onOpen} style={{ aspectRatio }} type="button">
    {posterUrl
      ? <img alt="Кадр видео" className="size-full object-contain" data-slot="telegram-video-poster" onError={() => onPosterReady?.(null)} onLoad={(event) => { const image = event.currentTarget; void image.decode().then(() => onPosterReady?.(posterUrl)).catch(() => onPosterReady?.(null)) }} src={posterUrl} />
      : <span className="absolute inset-0 flex items-center justify-center"><Typography as="span" tone="muted" variant="memoryBody">Видео</Typography></span>}
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" data-slot="telegram-video-play-control">
      {busy
        ? <Typography as="span" className="rounded-full bg-black/65 px-4 py-2 text-white shadow-sm backdrop-blur-[1px]" variant="memoryMeta">Открываем видео…</Typography>
        : <span className="flex size-14 items-center justify-center rounded-full bg-black/65 shadow-sm backdrop-blur-[1px]"><WebpIcon decorative name="play" size={24} state="white" /></span>}
    </span>
    <Typography as="span" className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-black/70 px-2 py-1 text-white" variant="memoryMeta">{formatDuration(durationMs)}</Typography>
  </button>
}

function MaxVideo({ attachment, autoplay = false, fullscreen, hostBridge, transport }: {
  attachment: Extract<MemoryAttachment, { source: 'max' }>
  autoplay?: boolean
  fullscreen?: boolean
  hostBridge: HostBridge
  transport: AuthenticatedTransport
}) {
  const root = useRef<HTMLDivElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const [readinessClock, setReadinessClock] = useState(() => Date.now())
  const { accountId, membershipEpoch } = useContext(VideoQueryScope)
  const queryClient = useQueryClient()
  const readinessPath = maxVideoReadinessPath(attachment.playbackPath)
  const posterReadinessPath = maxVideoPosterReadinessPath(attachment.playbackPath)
  const posterReadinessKey = [...feedQueryKeys.all, 'max-video-poster-readiness', accountId, membershipEpoch, posterReadinessPath] as const
  const posterReadiness = useQuery({
    queryKey: posterReadinessKey,
    queryFn: ({ signal }) => withMaxVideoReadinessSlot(signal, () => transport.request(posterReadinessPath!, maxVideoPosterReadinessSchema, { signal })),
    enabled: nearViewport && Boolean(posterReadinessPath) && attachment.posterState === 'pending',
    refetchInterval: (query) => maxVideoPosterReadinessInterval(query.state),
    refetchIntervalInBackground: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  const posterPath = attachment.posterState === undefined
    ? maxVideoPosterPath(attachment.playbackPath)
    : attachment.posterState === 'ready' ? attachment.posterPath ?? null
      : posterReadiness.data?.state === 'ready' ? posterReadiness.data.posterPath : null
  const posterUrl = usePrivateObjectUrl(posterPath, transport, nearViewport)
  const readinessKey = [...feedQueryKeys.all, 'max-video-readiness', accountId, membershipEpoch, readinessPath] as const
  const cachedReadiness = queryClient.getQueryState<MaxVideoReadiness>(readinessKey)
  const checkInterval = cachedReadiness ? maxVideoReadinessInterval(cachedReadiness) : 0
  const nextCheckAt = checkInterval === false ? null : Math.max(cachedReadiness?.dataUpdatedAt ?? 0, cachedReadiness?.errorUpdatedAt ?? 0) + checkInterval
  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setNearViewport(Boolean(entry?.isIntersecting)), { rootMargin: '600px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!nearViewport || nextCheckAt === null || nextCheckAt <= readinessClock) return
    const timer = window.setTimeout(() => setReadinessClock(Date.now()), Math.max(0, nextCheckAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [nearViewport, nextCheckAt, readinessClock])
  const readiness = useQuery({
    queryKey: readinessKey,
    queryFn: ({ signal }) => withMaxVideoReadinessSlot(signal, () => transport.request(readinessPath!, maxVideoReadinessSchema, { signal })),
    enabled: nearViewport && Boolean(readinessPath) && nextCheckAt !== null && nextCheckAt <= readinessClock,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })
  const readinessState = !readinessPath ? 'unknown' : readiness.data?.state ?? (readiness.isError ? 'check-error' : 'checking')
  const [sourceRequested, setSourceRequested] = useState(autoplay)
  const source = useMaxVideoSource(readinessState === 'ready' ? attachment.playbackPath : null, sourceRequested)
  const frameRatio = useMediaFrameRatio(attachment.id, [attachment])
  return <div className="memoly-max-video-readiness" ref={root}><MaxVideoPreview autoplay={autoplay} durationMs={attachment.durationMs} frameRatio={frameRatio} fullscreen={fullscreen} height={attachment.height} onCheckReadiness={readinessPath ? () => void readiness.refetch() : undefined} onOpen={() => hostBridge.openBot()} onReleaseSource={() => setSourceRequested(false)} onRequestSource={() => { if (source.resolved) source.retry(); setSourceRequested(true) }} onRetry={readinessState === 'ready' ? source.retry : undefined} poster={posterUrl ?? undefined} readinessState={readinessState} sourceStatus={readinessState === 'ready' ? source.status : 'loading'} src={readinessState === 'ready' && sourceRequested ? source.url : null} width={attachment.width} /></div>
}

type MaxVideoPreviewProps = {
  autoplay?: boolean
  durationMs: number | null
  frameRatio?: number
  fullscreen?: boolean
  height: number | null
  onOpen: () => void
  onCheckReadiness?: () => void
  onRetry?: () => void
  onRequestSource?: () => void
  onReleaseSource?: () => void
  poster?: string
  readinessState?: MaxVideoReadiness['state'] | 'checking' | 'check-error'
  sourceStatus?: 'loading' | 'ready' | 'error'
  src: string | null
  width: number | null
}

export function MaxVideoPreview(props: MaxVideoPreviewProps) {
  return <MaxVideoPreviewContent {...props} />
}

function MaxVideoPreviewContent({ autoplay = false, durationMs, frameRatio, fullscreen = false, height, onCheckReadiness, onOpen, onReleaseSource, onRequestSource, onRetry, poster, readinessState, sourceStatus, src, width }: MaxVideoPreviewProps) {
  const video = useRef<HTMLVideoElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const [sourceRequested, setSourceRequested] = useState(autoplay || Boolean(src))
  const clearPlayback = useRef<() => void>(() => undefined)
  const pendingPlay = useRef(false)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(durationMs ? durationMs / 1_000 : 0)
  const [failed, setFailed] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [decodedPosterUrl, setDecodedPosterUrl] = useState<string | null>(null)
  const [mediaErrorCode, setMediaErrorCode] = useState(0)
  const loadedSource = useRef<string | null>(null)
  const autoplayIntentConsumed = useRef(false)
  const onReleaseSourceRef = useRef(onReleaseSource)
  useEffect(() => { onReleaseSourceRef.current = onReleaseSource }, [onReleaseSource])
  const stopVideo = useCallback(() => {
    clearPlayback.current()
    pendingPlay.current = false
    setSourceRequested(false)
    onReleaseSourceRef.current?.()
    setStarted(false); setPlaying(false); setCurrent(0)
    setFailed(false); setPreviewReady(false); setMediaErrorCode(0)
    loadedSource.current = null
    if (video.current) releaseVideoSource(video.current)
  }, [])
  const playback = usePlaybackRegistration(`max-video:${src ?? 'missing'}`, video, stopVideo)
  useEffect(() => { clearPlayback.current = playback.clear }, [playback.clear])
  const activate = playback.activate
  const sourceFailed = sourceStatus === 'error'
  const hasDecodedPoster = Boolean(poster && decodedPosterUrl === poster)
  const viewerState = readinessState === 'processing' || readinessState === 'unknown' || readinessState === 'unavailable' || readinessState === 'checking' || readinessState === 'check-error'
    ? readinessState
    : sourceFailed || failed ? 'error' : src ? 'ready' : sourceRequested ? 'loading' : 'ready'
  const frameStyle = videoFrameStyle(width, height, fullscreen, frameRatio)
  useEffect(() => {
    const element = video.current
    if (!sourceRequested || !element || !src) return
    loadedSource.current = loadMaxVideoSourceOnce(element, src, loadedSource.current)
  }, [src, sourceRequested])
  useVideoViewportLifecycle(stage, video, fullscreen, sourceRequested, stopVideo)
  useEffect(() => {
    if (!autoplay || autoplayIntentConsumed.current) return
    autoplayIntentConsumed.current = true
    pendingPlay.current = true
    activate()
  }, [autoplay, activate])
  useEffect(() => {
    if (!pendingPlay.current || !src) return
    const element = video.current
    if (!element) return
    pendingPlay.current = false
    void element.play().catch(() => { if (!element.paused) return; setFailed(false); setPlaying(false) })
  }, [src])
  return <div aria-label="Видео" className="ml-media-slot memoly-video-viewer-v2 w-full" data-seen-ready={mediaCardSeenReady({ kind: 'video', viewerState: viewerState === 'ready' || viewerState === 'error' ? viewerState : 'loading', previewReady: previewReady || decodedPosterUrl === poster })} data-video-started={started} data-video-viewer-state={viewerState}>
    <div className="relative isolate max-h-[75dvh] w-full overflow-hidden memoly-video-viewer-v2-frame" data-media-error-code={mediaErrorCode} data-slot="max-video-frame" ref={stage} style={frameStyle}>
      <video aria-label="Предпросмотр видео" className="absolute inset-0 z-10 size-full object-contain" onEnded={(event) => { setCurrent(event.currentTarget.currentTime); setPlaying(false) }} onError={(event) => { if (!sourceRequested) return; const code = event.currentTarget.error?.code; const sanitizedCode = typeof code === 'number' && Number.isInteger(code) && code >= 0 ? code : 0; setMediaErrorCode(sanitizedCode); setFailed(true); setPlaying(false); setPreviewReady(false) }} onLoadedData={() => { if (sourceRequested) setPreviewReady(true) }} onLoadedMetadata={(event) => {
        if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) setDuration(event.currentTarget.duration)
        const element = event.currentTarget
        const seekableEnd = element.seekable.length > 0 ? element.seekable.end(element.seekable.length - 1) : 0
        if (started && ((Number.isFinite(element.duration) && element.duration > 0.001) || seekableEnd > 0.001)) {
          try { element.currentTime = 0.001 } catch { /* Some WebViews reject a seek before the first frame is buffered. */ }
        }
      }} onPause={(event) => { setCurrent(event.currentTarget.currentTime); setPlaying(false) }} onPlay={(event) => { if (!sourceRequested) { event.currentTarget.pause(); releaseVideoSource(event.currentTarget); return }; activate(); setStarted(true); setPlaying(true) }} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} poster={started ? undefined : poster} preload="none" playsInline ref={video} />
      {!started && !failed && !sourceFailed && readinessState !== 'processing' && readinessState !== 'unknown' && readinessState !== 'unavailable' && readinessState !== 'check-error' ? <button aria-label="Смотреть видео" className="absolute inset-0 z-20 flex items-center justify-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50" disabled={!src && !onRequestSource} onClick={() => void (async () => {
        const element = video.current
        if (!element) return
        if (src && loadedSource.current === src && element.src) {
          pendingPlay.current = false
          activate()
          try { await element.play() } catch (error) { if ((error as Error)?.name !== 'NotAllowedError' && (error as Error)?.name !== 'AbortError') setFailed(true) }
          return
        }
        activate()
        pendingPlay.current = true
        setSourceRequested(true)
        onRequestSource?.()
        if (!src) return
        try { await element.play() } catch (error) { if ((error as Error)?.name !== 'NotAllowedError' && (error as Error)?.name !== 'AbortError') setFailed(true) }
      })()} type="button">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-black/65 shadow-sm backdrop-blur-[1px]"><WebpIcon decorative name="play" size={24} state="white" /></span>
      </button> : null}
      {viewerState !== 'ready' && !hasDecodedPoster ? <div aria-hidden="true" className="memoly-video-viewer-v2-placeholder"><WebpIcon decorative name="video" size={48} /></div> : null}
      {!started && poster && !previewReady ? <img alt="Кадр видео" className="pointer-events-none absolute inset-0 z-0 size-full object-contain" onLoad={(event) => {
        const image = event.currentTarget
        void image.decode().then(() => { setDecodedPosterUrl(poster) }).catch(() => undefined)
      }} src={poster} /> : null}
      {!started ? <Typography as="span" className="pointer-events-none absolute bottom-3 right-3 z-20 rounded bg-black/70 px-2 py-1 text-white" variant="memoryMeta">{formatDuration(durationMs)}</Typography> : null}
      {started && viewerState === 'ready' ? <VideoPlaybackControls available={Boolean(src)} current={current} duration={duration} onSeek={(position) => { if (video.current) video.current.currentTime = position; setCurrent(position) }} onToggle={() => void (async () => { const element = video.current; if (!element) return; if (element.paused) { try { await element.play() } catch { setFailed(true) } } else element.pause() })()} playing={playing} stageRef={stage} videoRef={video} /> : null}
    </div>
    {viewerState === 'loading' || viewerState === 'checking' || viewerState === 'processing' || viewerState === 'unknown' || viewerState === 'check-error' ? <div className="memoly-video-viewer-v2-status" role="status">{viewerState !== 'unknown' && viewerState !== 'check-error' ? <span className="memoly-video-viewer-v2-spinner" aria-hidden="true" /> : null}<Typography as="span" variant="memoryMeta">{viewerState === 'processing' ? 'Видео обрабатывается…' : viewerState === 'unknown' ? 'Готовность видео пока неизвестна' : viewerState === 'check-error' ? 'Не удалось проверить готовность видео' : viewerState === 'checking' ? 'Проверяем готовность видео…' : 'Загружаем видео…'}</Typography></div> : null}
    {viewerState === 'unavailable' ? <div className="memoly-video-viewer-v2-error" role="alert"><Typography as="strong" variant="memoryBodyMedium">Видео недоступно</Typography></div> : null}
    {viewerState === 'error' ? <div className="memoly-video-viewer-v2-error" role="alert"><Typography as="strong" variant="memoryBodyMedium">Не удалось загрузить видео</Typography><Typography as="span" variant="memoryMeta">Попробуйте открыть оригинал в MAX.</Typography></div> : null}
    {(viewerState === 'processing' || viewerState === 'unknown' || viewerState === 'check-error') && onCheckReadiness ? <Button className="memoly-video-viewer-v2-retry" onClick={onCheckReadiness} type="button">Проверить готовность</Button> : null}
    {viewerState === 'error' && (onRetry || src) ? <Button className="memoly-video-viewer-v2-retry" onClick={() => { setPreviewReady(false); if (sourceFailed) onRetry?.(); else { setFailed(false); video.current?.load() } }} type="button">Повторить</Button> : null}
    {viewerState === 'error' || viewerState === 'unavailable' ? <Button className="memoly-video-viewer-v2-open" onClick={onOpen} type="button" variant="outline">Открыть в MAX</Button> : null}
  </div>
}

function useMaxVideoSource(path: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ path: string | null; status: 'loading' | 'ready' | 'error'; url: string | null }>({ path: null, status: 'loading', url: null })
  useEffect(() => {
    let cancelled = false
    if (!path || !enabled) return () => { cancelled = true }
    const controller = new AbortController()
    void privateMediaSource(path, controller.signal).then((url) => {
      if (!cancelled) setState({ path, status: url ? 'ready' : 'error', url })
    }).catch((error) => {
      if (!cancelled && (error as Error)?.name !== 'AbortError') setState({ path, status: 'error', url: null })
    })
    return () => { cancelled = true; controller.abort() }
  }, [path, attempt, enabled])
  const current = !path ? { path, status: 'error' as const, url: null } : !enabled ? { path, status: 'loading' as const, url: null } : state.path === path ? state : { path, status: 'loading' as const, url: null }
  return { ...current, resolved: state.path === path, retry: () => { setState({ path: null, status: 'loading', url: null }); setAttempt((value) => value + 1) } }
}

function videoPosterAspectRatio(width: number | null, height: number | null) {
  return mediaAspectRatio(width, height) ?? '16 / 9'
}

function videoFrameStyle(width: number | null, height: number | null, fullscreen = false, frameRatio?: number) {
  if (fullscreen) return { width: '100%', height: '100%', maxHeight: '100%', marginInline: 'auto' }
  return {
    aspectRatio: frameRatio ?? getMediaFrameRatio([{ id: 'video', kind: 'video', width, height }]),
    marginInline: 'auto',
    width: '100%',
  }
}

function mediaAspectRatio(width: number | null, height: number | null) {
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
    ? `${width} / ${height}`
    : undefined
}

function PrivateImage({ attachment, borrowedUrl, caption, hostBridge, photoAlbum, photoIndex, registerFullscreen, onOpenPhoto, onUrlChange, interactive = true, transport }: {
  attachment: Extract<MemoryAttachment, { source: 'private_storage' }>
  borrowedUrl?: string
  caption: string
  hostBridge: HostBridge
  photoAlbum: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>
  photoIndex: number
  registerFullscreen?: (element: HTMLElement | null) => void
  onOpenPhoto?: (trigger: HTMLElement, photoUrl: string) => void
  onUrlChange?: (attachmentId: string, url: string | null) => void
  interactive?: boolean
  transport: AuthenticatedTransport
}) {
  const path = attachment.displayPath ?? attachment.previewPath
  const ownedUrl = usePrivateObjectUrl(path, transport, !borrowedUrl)
  const url = borrowedUrl ?? ownedUrl
  const [readyUrl, setReadyUrl] = useState<string | null>(null)
  const viewerSession = useRef<AbortController | null>(null)
  const notifyUrlChange = useEffectEvent((nextUrl: string | null) => onUrlChange?.(attachment.id, nextUrl))
  useEffect(() => () => { viewerSession.current?.abort() }, [])
  useEffect(() => {
    const closeViewer = () => viewerSession.current?.abort()
    document.addEventListener('memoly:feed-inactive', closeViewer)
    return () => document.removeEventListener('memoly:feed-inactive', closeViewer)
  }, [])
  useLayoutEffect(() => {
    notifyUrlChange(ownedUrl)
    return () => notifyUrlChange(null)
  }, [attachment.id, ownedUrl])
  if (!url) return <div aria-label="Загрузка фотографии" className="w-full bg-muted" style={{ aspectRatio: mediaAspectRatio(attachment.width, attachment.height) ?? '16 / 9' }} />
  const onImageLoad: React.ReactEventHandler<HTMLImageElement> = (event) => { const loadedImage = event.currentTarget; void loadedImage.decode().then(() => setReadyUrl(url)).catch(() => setReadyUrl(null)) }
  if (!interactive) return <div className="ml-media-button block w-full" data-seen-ready={readyUrl === url}><PhotoImage alt="Воспоминание" height={attachment.height} onError={() => setReadyUrl(null)} onLoad={onImageLoad} src={url} width={attachment.width} /></div>
  return <button aria-label="Открыть фото" className="ml-media-button block w-full" data-seen-ready={readyUrl === url} onClick={(event) => {
    if (onOpenPhoto) { onOpenPhoto(event.currentTarget, url); return }
    viewerSession.current?.abort()
    const session = new AbortController()
    viewerSession.current = session
    void showPrivatePhotoAlbum(photoAlbum, photoIndex, transport, event.currentTarget, hostBridge, session.signal, registerFullscreen, undefined, undefined, caption)
      .finally(() => { if (viewerSession.current === session) viewerSession.current = null })
  }} type="button"><PhotoImage alt="Воспоминание" height={attachment.height} onError={() => setReadyUrl(null)} onLoad={onImageLoad} src={url} width={attachment.width} /></button>
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

const VOICE_FALLBACK_WAVEFORM = Array.from({ length: 48 }, (_, index) => 0.18 + ((index * 7) % 11) / 20)

function AudioPlayer({ durationMs, path, waveform }: { durationMs: number | null; path: string | null; waveform: number[] | null }) {
  const { url } = usePrivateMediaSource(path)
  const audio = useRef<HTMLAudioElement | null>(null)
  const playbackAttempt = useRef(0)
  const { activate } = usePlaybackRegistration(`audio:${path ?? 'missing'}`, audio)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(() => durationMs ? durationMs / 1_000 : 0)
  useEffect(() => {
    playbackAttempt.current += 1
    return () => { playbackAttempt.current += 1 }
  }, [url])
  const updateDuration = (element: HTMLAudioElement) => { if (Number.isFinite(element.duration) && element.duration >= 0) setDuration(element.duration) }
  const syncCurrent = (element: HTMLAudioElement) => setCurrent(element.currentTime)
  return <div className="ml-audio p-4" data-seen-ready={mediaCardSeenReady({ kind: 'voice', objectUrl: url })}><audio onDurationChange={(e) => updateDuration(e.currentTarget)} onEnded={(e) => { if (!e.currentTarget.ended) return; if (Number.isFinite(e.currentTarget.duration)) setCurrent(e.currentTarget.duration); playbackAttempt.current += 1; setPlaying(false) }} onLoadedMetadata={(e) => updateDuration(e.currentTarget)} onPause={(e) => { if (!e.currentTarget.paused) return; playbackAttempt.current += 1; setPlaying(false) }} onPlay={(e) => { if (e.currentTarget.paused) return; activate(); syncCurrent(e.currentTarget); setPlaying(true) }} onSeeking={(e) => syncCurrent(e.currentTarget)} onTimeUpdate={(e) => syncCurrent(e.currentTarget)} preload="none" ref={audio} src={url ?? undefined} />
    <div className="memoly-voice-player" data-slot="voice-player"><Button aria-label={playing ? 'Приостановить голосовое' : 'Воспроизвести голосовое'} className="memoly-voice-play" disabled={!url} onClick={() => { const element = audio.current; if (!element) return; const attempt = ++playbackAttempt.current; void toggleAudioPlayback(element, () => playbackAttempt.current === attempt, setPlaying) }} type="button"><WebpIcon decorative name={playing ? 'pause' : 'play'} size={24} state="white" /></Button><div className="memoly-voice-track"><VoiceSeek current={current} duration={duration} onSeek={(position) => { if (audio.current) audio.current.currentTime = position; setCurrent(position) }} waveform={waveform} /><Typography className="memoly-voice-time" tone="muted" variant="memoryMeta">{seconds(current)} / {roundedSeconds(duration)}</Typography></div></div>
  </div>
}

function VoiceSeek({ current, duration, onSeek, waveform }: { current: number; duration: number; onSeek: (position: number) => void; waveform: number[] | null }) {
  const peaks = waveform?.length === 48 ? waveform : VOICE_FALLBACK_WAVEFORM
  const progress = voiceWaveformProgress(current, duration)
  return <div className="relative flex h-10 items-center gap-px" data-slot="voice-waveform">
    {peaks.map((peak, index) => {
      const played = isVoiceWaveformPeakPlayed(index, peaks.length, progress)
      return <span aria-hidden="true" className="min-h-1 flex-1 rounded-full" data-waveform-peak="" data-waveform-played={played} key={index} style={{ backgroundColor: played ? 'var(--memory-accent-strong)' : 'var(--memory-line)', height: `${Math.max(10, Math.min(100, peak * 100))}%` }} />
    })}
    <div className="absolute inset-0 flex h-11 items-center opacity-0 focus-within:opacity-100"><input aria-label="Позиция голосового сообщения" className="h-11 w-full" max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.target.value))} step="0.1" type="range" value={current} /></div>
  </div>
}

function PrivateVideo({ attachment, autoplay = false, fullscreen = false, memory, transport }: { attachment: Extract<MemoryAttachment, { source: 'private_storage' }>; autoplay?: boolean; fullscreen?: boolean; memory: MemoryDto; transport: AuthenticatedTransport }) {
  const frameRatio = useMediaFrameRatio(memory.id, [attachment])
  const { accountId, membershipEpoch } = useContext(VideoQueryScope)
  const rendition = useQuery({
    queryKey: pendingVideoQueryKey(memory.familyId, accountId, membershipEpoch, memory.id),
    queryFn: ({ signal }) => loadMemory(transport, memory.familyId, memory.id, signal),
    enabled: false,
    retry: false,
  })
  const currentAttachment = rendition.data?.id === memory.id && rendition.data.familyId === memory.familyId
    ? rendition.data.attachments.find((item) => item.id === attachment.id)
    : undefined
  const privateVideoUpdate = currentAttachment?.source === 'private_storage' && currentAttachment.kind === 'video' ? currentAttachment : undefined
  const posterArrived = !attachment.previewPath && !attachment.displayPath && Boolean(privateVideoUpdate?.previewPath || privateVideoUpdate?.displayPath)
  const renditionFinished = attachment.renditionStatus === 'pending' && privateVideoUpdate?.renditionStatus !== undefined && privateVideoUpdate.renditionStatus !== 'pending'
  const effective = privateVideoUpdate && (posterArrived || renditionFinished) ? privateVideoUpdate : attachment
  const { playbackPath: path, renditionStatus } = effective
  const playablePath = renditionStatus === 'ready' ? path : null
  const [sourceRequested, setSourceRequested] = useState(autoplay)
  const source = usePrivateMediaSource(playablePath, sourceRequested)
  const url = source.url
  const posterPath = effective.displayPath ?? effective.previewPath
  const video = useRef<HTMLVideoElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)
  const posterUrl = usePrivateObjectUrl(posterPath, transport, nearViewport)
  useEffect(() => {
    const element = stage.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setNearViewport(Boolean(entry?.isIntersecting)), { rootMargin: '600px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const pendingPlay = useRef(false)
  const autoplayIntentConsumed = useRef(false)
  const clearPlayback = useRef<() => void>(() => undefined)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(effective.durationMs ? effective.durationMs / 1_000 : 0)
  const [failed, setFailed] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [started, setStarted] = useState(false)
  const stopVideo = useCallback(() => {
    clearPlayback.current()
    pendingPlay.current = false
    setSourceRequested(false); setStarted(false); setPlaying(false); setCurrent(0)
    setFailed(false); setPreviewReady(false)
    if (video.current) releaseVideoSource(video.current)
  }, [])
  const playback = usePlaybackRegistration(`video:${path ?? 'missing'}`, video, stopVideo)
  useEffect(() => { clearPlayback.current = playback.clear }, [playback.clear])
  const activate = playback.activate
  const viewerState = renditionStatus === 'pending' ? 'loading' : renditionStatus === 'failed' || failed || (sourceRequested && source.status === 'error') ? 'error' : sourceRequested ? source.status : 'ready'
  useVideoViewportLifecycle(stage, video, fullscreen, sourceRequested, stopVideo)
  useEffect(() => {
    if (!pendingPlay.current || !url) return
    const element = video.current
    if (!element) return
    pendingPlay.current = false
    void element.play().catch(() => { setFailed(false); setPlaying(false) })
  }, [url])
  useEffect(() => {
    if (!autoplay || autoplayIntentConsumed.current) return
    autoplayIntentConsumed.current = true
    pendingPlay.current = true
    activate()
  }, [autoplay, activate])
  return <div className="ml-video-row memoly-private-video-v2" data-seen-ready={mediaCardSeenReady({ kind: 'video', viewerState, previewReady })} data-video-viewer-state={viewerState}><div className="memoly-private-video-v2-frame" data-video-poster-state={posterUrl ? 'ready' : 'pending'} ref={stage} style={videoFrameStyle(attachment.width, attachment.height, fullscreen, frameRatio)}><video aria-label="Видео воспоминания" className="h-full w-full" onEnded={(e) => { setCurrent(e.currentTarget.currentTime); setPlaying(false) }} onError={() => { if (!sourceRequested) return; setFailed(true); setPlaying(false); setPreviewReady(false) }} onLoadedData={() => { if (sourceRequested) setPreviewReady(true) }} onLoadedMetadata={(e) => { if (!sourceRequested) return; setDuration(e.currentTarget.duration) }} onPause={(e) => { setCurrent(e.currentTarget.currentTime); setPlaying(false) }} onPlay={(e) => { if (!sourceRequested) { e.currentTarget.pause(); releaseVideoSource(e.currentTarget); return }; setFailed(false); setStarted(true); activate(); setPlaying(true) }} onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)} playsInline poster={started ? undefined : posterUrl ?? undefined} preload="none" ref={video} src={url ?? undefined} />
    {!started ? <div aria-hidden="true" className="memoly-private-video-v2-poster" data-slot="private-video-poster">{posterUrl ? <img alt="" className="size-full object-contain" src={posterUrl} /> : null}</div> : null}
    {!started && viewerState !== 'error' ? <button aria-label="Воспроизвести видео" className="memoly-private-video-v2-play" disabled={!playablePath} onClick={() => { const element = video.current; if (!element) return; if (url && source.resolved && element.getAttribute('src') === url) { pendingPlay.current = false; activate(); void element.play().catch((error) => { if ((error as Error)?.name !== 'NotAllowedError' && (error as Error)?.name !== 'AbortError') setFailed(true) }); return }; activate(); pendingPlay.current = true; if (source.resolved) source.retry(); setSourceRequested(true); if (url) void element.play().catch((error) => { if ((error as Error)?.name !== 'NotAllowedError' && (error as Error)?.name !== 'AbortError') setFailed(true) }) }} type="button"><WebpIcon decorative name="play" size={24} state="white" /></button> : null}
    {!started ? <Typography as="span" className="memoly-private-video-v2-duration" variant="memoryMeta">{formatDuration(effective.durationMs)}</Typography> : null}
    {viewerState === 'loading' ? <Typography as="p" className="memoly-private-video-v2-state" role="status" variant="memoryMeta">{renditionStatus === 'pending' ? 'Подготавливаем видео…' : 'Загружаем видео…'}</Typography> : null}
    {viewerState === 'error' ? <div className="memoly-private-video-v2-state" role="alert"><Typography as="p" variant="memoryBodyMedium">Не удалось загрузить видео</Typography>{playablePath ? <Button onClick={() => { setFailed(false); source.retry(); video.current?.load() }} type="button">Повторить</Button> : null}</div> : null}
    {started && viewerState !== 'error' ? <VideoPlaybackControls available={Boolean(url)} current={current} duration={duration} onSeek={(position) => { if (video.current) video.current.currentTime = position; setCurrent(position) }} onToggle={() => void (async () => { const element = video.current; if (!element) return; if (element.paused) { try { await element.play() } catch { setFailed(true) } } else element.pause() })()} playing={playing} stageRef={stage} videoRef={video} /> : null}</div>
    {renditionStatus === 'pending' ? <div className="memoly-private-video-v2-readiness"><Button disabled={rendition.isFetching} onClick={() => void rendition.refetch()} type="button" variant="outline">{rendition.isFetching ? 'Проверяем…' : 'Проверить готовность'}</Button>{rendition.isError ? <Typography as="p" role="alert" variant="memoryMeta">Не удалось проверить видео. Попробуйте ещё раз.</Typography> : null}</div> : null}
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

function usePrivateObjectUrl(path: string | null, transport?: AuthenticatedTransport, enabled = true, onSettled?: () => void) {
  const auth = useContext(AuthContext)
  const mediaTransport = transport ?? auth?.transport
  return usePrivateImageUrl(auth?.user?.id ?? '', path, mediaTransport, enabled && Boolean(mediaTransport), onSettled)
}

function usePrivateMediaSource(path: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ path: string; status: 'ready' | 'error'; url: string | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!path || !enabled) return
    const controller = new AbortController()
    void privateMediaSource(path, controller.signal).then((source) => { if (!cancelled) setLoaded({ path, status: source ? 'ready' : 'error', url: source }) }).catch((error) => { if (!cancelled && (error as Error)?.name !== 'AbortError') setLoaded({ path, status: 'error', url: null }) })
    return () => { cancelled = true; controller.abort() }
  }, [path, attempt, enabled])
  const current = !path ? { status: 'error' as const, url: null } : !enabled ? { status: 'loading' as const, url: null } : loaded?.path === path ? loaded : { status: 'loading' as const, url: null }
  return { ...current, resolved: loaded?.path === path, retry: () => { setLoaded(null); setAttempt((value) => value + 1) } }
}

async function showPrivatePhotoAlbum(
  attachments: Array<Extract<MemoryAttachment, { source: 'private_storage' }>>,
  index: number,
  transport: AuthenticatedTransport,
  trigger: HTMLElement,
  hostBridge: HostBridge,
  signal: AbortSignal,
  registerFullscreen?: (element: HTMLElement | null) => void,
  onIndexChange?: (index: number) => void,
  returnFocusRef?: RefObject<HTMLElement | null>,
  caption = '',
) {
  const scrollY = window.scrollY
  const slides: Array<{ src: string; width?: number; height?: number }> = []
  let selectedIndex = index
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
    await showPhoto(slides, index, hostBridge, signal, registerFullscreen, (next) => {
      selectedIndex = next
      onIndexChange?.(next)
    }, caption)
  } finally {
    slides.forEach(({ src }) => URL.revokeObjectURL(src))
    window.scrollTo({ top: scrollY })
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const carousel = trigger.closest<HTMLElement>('[data-carousel-memory]')
    const selectedTarget = carousel?.querySelector<HTMLElement>(`[data-carousel-position="${selectedIndex + 1}"] button`)
    const focusTarget = selectedTarget ?? returnFocusRef?.current
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
    else if (trigger.isConnected) trigger.focus({ preventScroll: true })
  }
}

async function showPhoto(
  slides: Array<{ src: string; width?: number; height?: number }>,
  index: number,
  hostBridge: HostBridge,
  signal: AbortSignal,
  registerFullscreen?: (element: HTMLElement | null) => void,
  onIndexChange?: (index: number) => void,
  caption = '',
) {
  const { default: PhotoSwipe } = await import('photoswipe')
  if (signal.aborted) return
  const gallery = new PhotoSwipe({ dataSource: slides, index, loop: false, returnFocus: false, showHideAnimationType: 'none', paddingFn: (viewportSize) => ({ top: 0, right: 0, bottom: Math.min(157, Math.max(106, viewportSize.y * .24)), left: 0 }) })
  let closingFromHistory = false
  gallery.on('uiRegister', () => {
    gallery.ui?.registerElement({
      name: 'memolyFooter',
      appendTo: 'root',
      order: 10,
      onInit: (element, pswp) => {
        element.classList.add('pswp__memoly-footer')
        const captionElement = document.createElement('div')
        captionElement.className = 'pswp__memoly-caption'
        captionElement.textContent = caption
        captionElement.hidden = !caption.trim()
        const thumbnails = document.createElement('div')
        thumbnails.className = 'pswp__memoly-thumbnails'
        thumbnails.setAttribute('aria-label', 'Миниатюры фотографий')
        thumbnails.setAttribute('role', 'group')
        const buttons = slides.map((slide, slideIndex) => {
          const button = document.createElement('button')
          button.className = 'pswp__button pswp__memoly-thumbnail'
          button.type = 'button'
          button.setAttribute('aria-label', `Перейти к фото ${slideIndex + 1} из ${slides.length}`)
          button.setAttribute('aria-pressed', String(slideIndex === pswp.currIndex))
          const image = document.createElement('img')
          image.alt = ''
          image.src = slide.src
          button.append(image)
          button.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            pswp.goTo(slideIndex)
          })
          thumbnails.append(button)
          return button
        })
        if (caption.trim()) element.append(captionElement)
        if (slides.length > 1) element.append(thumbnails)
        const syncIndex = () => buttons.forEach((button, slideIndex) => button.setAttribute('aria-pressed', String(slideIndex === pswp.currIndex)))
        pswp.on('change', syncIndex)
        syncIndex()
      },
    })
  })
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
    gallery.on('change', () => onIndexChange?.(gallery.currIndex))
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
function timeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value)) }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '•' }
function seconds(value: number) { return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00' }
function roundedSeconds(value: number) { return Number.isFinite(value) ? seconds(Math.round(value)) : '0:00' }
function formatDuration(value: number | null) { return value ? seconds(value / 1_000) : 'Длительность уточняется' }
