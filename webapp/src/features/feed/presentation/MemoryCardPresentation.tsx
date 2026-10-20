import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import type { MemoryDto, MemoryReaction } from '@web-app-demo/contracts'

import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import type { ChildAvatarCrop } from '@/components/ChildHeader'
import { FeedAuthorAvatar } from '../shared-author-avatars'
import { NoteStoryPresentation } from './NoteStoryPresentation'
import { MemoryReactions } from './MemoryReactions'
import type { ReactionHapticStyle } from '@/platform/reaction-haptics'
import { installRetargetedTouchClickGuard } from './retargeted-touch-click-guard'

const HOLD_SLOP_PX = 12
const INTERACTIVE_HOLD_EXCLUSIONS = 'input, select, textarea, a, [data-slot="memory-actions"], [data-reaction-result], [role="button"], [role="slider"], [role="textbox"], [role="combobox"], .reaction-picker, .memoly-mixed-controls, .memoly-private-video-v2-controls, .memoly-video-viewer-v2-controls, [data-slot="voice-waveform"], .ml-audio button, .ml-audio input, .voice-control'

function isHoldEligibleTarget(target: Element, article: HTMLElement, x: number, y: number, kind: MemoryDto['kind']) {
  const editable = target.closest('[contenteditable]')
  const editableValue = editable?.getAttribute('contenteditable')?.toLowerCase()
  if (target.closest(INTERACTIVE_HOLD_EXCLUSIONS) || (editable && editableValue !== 'false')) return false
  if (target.closest('[data-memoly-note-gradient]')) return true
  if (target.closest('.memory-media-slot, .memoly-mixed-slide-media')) {
    const videoSurface = kind === 'video' || target.closest('[data-media-kind="video"]') !== null
    if (target.closest('.ml-media-button')) return !videoSurface
    const posterButton = target.closest('button[aria-label="Смотреть видео"], button[aria-label="Смотреть видео в Telegram"]')
    if (posterButton) {
      const rect = posterButton.getBoundingClientRect()
      if (Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2)) < 48) return false
      if (y > rect.bottom - 48 && x > rect.right - 76) return false
      return true
    }
    if (target.closest('.memoly-private-video-v2-controls, .memoly-video-viewer-v2-controls, .memoly-mixed-controls, [data-slot="voice-waveform"], .ml-audio button, .ml-audio input, .voice-control')) return false
    if (target.closest('button, video, audio')) {
      const video = target.closest('video')
      if (video) return y <= video.getBoundingClientRect().bottom - 44
      return false
    }
    return Boolean(target.closest('img, .ml-audio, .memoly-private-video-v2-frame, .memoly-video-viewer-v2-frame, .memoly-mixed-slide, .memoly-private-video-v2, .memoly-video-viewer-v2'))
  }
  return !target.closest('button, video, audio') && article.contains(target)
}

export type MemoryCardPresentationProps = {
  actions: ReactNode
  authorInitials: string
  authorName: string
  authorAvatarPath?: string | null
  authorAvatarCrop?: { x: number; y: number; width: number; height: number } | null
  authorKind?: 'channel' | 'user'
  childName?: string
  childAvatarUrl?: string | null
  childAvatarCrop?: ChildAvatarCrop | null
  body: string
  kind: MemoryDto['kind']
  reactionCounts: MemoryDto['reactionCounts']
  currentUserReaction: MemoryReaction | null
  media: ReactNode
  memoryId: string
  mode?: 'feed' | 'delete-preview'
  isDeleteSource?: boolean
  reactionScopeKey?: string
  occurredTime: string
  onReaction: (reaction: MemoryReaction | null) => void
  onReactionFeedback?: (style: ReactionHapticStyle) => void
  onOpen: () => void
  seenContentRef?: Ref<HTMLDivElement>
  commentCount?: number
  onComments?: () => void
}

export function MemoryCardPresentation({
  actions,
  authorInitials,
  authorName,
  authorAvatarPath,
  authorAvatarCrop,
  authorKind = 'user',
  body,
  kind,
  reactionCounts,
  currentUserReaction,
  media,
  memoryId,
  mode = 'feed',
  isDeleteSource = false,
  reactionScopeKey,
  occurredTime,
  onReaction,
  onReactionFeedback,
  onOpen,
  seenContentRef,
  commentCount,
  onComments,
}: MemoryCardPresentationProps) {
  const hasCaption = body.trim().length > 0
  const interactive = mode === 'feed'
  const articleRef = useRef<HTMLElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerRef = useRef<{ id: number; x: number; y: number; target: EventTarget | null; pointerType: string } | null>(null)
  const recognizedPointerRef = useRef<{ id: number; target: EventTarget | null } | null>(null)
  const didHoldRef = useRef(false)
  const holdClickTargetRef = useRef<Element | null>(null)
  const holdResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pickerState, setPickerState] = useState({ open: false, context: '' })
  const reactionContext = `${memoryId}:${reactionScopeKey ?? ''}`
  const pickerOpen = pickerState.open && pickerState.context === reactionContext
  const pickerOpenRef = useRef(pickerOpen)
  const setPickerOpen = useCallback((open: boolean) => {
    pickerOpenRef.current = open
    setPickerState({ open, context: reactionContext })
  }, [reactionContext])
  const [pickerPoint, setPickerPoint] = useState({ x: 0, y: 0 })

  const cancelPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    pointerRef.current = null
  }, [])

  useEffect(() => {
    pickerOpenRef.current = false
    const cancelOnScroll = () => { cancelPending(); setPickerOpen(false) }
    const article = articleRef.current
    const blockNativePublicationMenu = (event: Event) => {
      const eventTarget = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null
      const target = eventTarget instanceof Element ? eventTarget : null
      const pointer = pointerRef.current
      const x = event instanceof MouseEvent ? event.clientX : pointer?.x ?? 0
      const y = event instanceof MouseEvent ? event.clientY : pointer?.y ?? 0
      if (interactive && article && target && isHoldEligibleTarget(target, article, x, y, kind)) event.preventDefault()
    }
    const clearReleasedHoldLatch = (event: PointerEvent) => {
      if (event.isPrimary === false || event.button !== 0 || !holdClickTargetRef.current) return
      didHoldRef.current = false
      holdClickTargetRef.current = null
      recognizedPointerRef.current = null
      if (holdResetTimerRef.current) { clearTimeout(holdResetTimerRef.current); holdResetTimerRef.current = null }
    }
    const cancelOtherPointer = (event: PointerEvent) => {
      if (pointerRef.current && event.pointerId !== pointerRef.current.id) cancelPending()
    }
    const cancelOnGlobalMove = (event: PointerEvent) => {
      const pointer = pointerRef.current
      if (pointer && pointer.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > HOLD_SLOP_PX) cancelPending()
    }
    const cancelReleasedPointer = (event: PointerEvent) => {
      const pointer = pointerRef.current?.id === event.pointerId ? pointerRef.current : null
      const recognized = recognizedPointerRef.current?.id === event.pointerId ? recognizedPointerRef.current : null
      if (pointer || recognized) {
        if (didHoldRef.current) {
          const originalTarget = recognized?.target ?? pointer?.target
          const target = originalTarget instanceof Element ? originalTarget : null
          holdClickTargetRef.current = target?.closest('button') ?? target
          if (holdResetTimerRef.current) clearTimeout(holdResetTimerRef.current)
          holdResetTimerRef.current = setTimeout(() => { didHoldRef.current = false; holdClickTargetRef.current = null; recognizedPointerRef.current = null }, 900)
        }
        recognizedPointerRef.current = null
        cancelPending()
      }
    }
    const cancelCancelledPointer = (event: PointerEvent) => {
      if (pointerRef.current?.id !== event.pointerId && recognizedPointerRef.current?.id !== event.pointerId) return
      recognizedPointerRef.current = null
      didHoldRef.current = false
      holdClickTargetRef.current = null
      if (holdResetTimerRef.current) clearTimeout(holdResetTimerRef.current)
      cancelPending()
    }
    document.addEventListener('scroll', cancelOnScroll, true)
    if (interactive) { article?.addEventListener('selectstart', blockNativePublicationMenu); article?.addEventListener('contextmenu', blockNativePublicationMenu) }
    document.addEventListener('pointerdown', clearReleasedHoldLatch, true)
    document.addEventListener('pointerdown', cancelOtherPointer, true)
    document.addEventListener('pointermove', cancelOnGlobalMove, true)
    document.addEventListener('pointerup', cancelReleasedPointer, true)
    document.addEventListener('pointercancel', cancelCancelledPointer, true)
    window.addEventListener('blur', cancelOnScroll)
    document.addEventListener('visibilitychange', cancelOnScroll)
    window.addEventListener('pagehide', cancelOnScroll)
    return () => {
      const pendingTouch = pointerRef.current?.pointerType === 'touch' ? pointerRef.current : null
      if (pendingTouch) installRetargetedTouchClickGuard(document, window, pendingTouch.id, pendingTouch.x, pendingTouch.y)
      document.removeEventListener('scroll', cancelOnScroll, true); article?.removeEventListener('selectstart', blockNativePublicationMenu); article?.removeEventListener('contextmenu', blockNativePublicationMenu); document.removeEventListener('pointerdown', clearReleasedHoldLatch, true); document.removeEventListener('pointerdown', cancelOtherPointer, true); document.removeEventListener('pointermove', cancelOnGlobalMove, true); document.removeEventListener('pointerup', cancelReleasedPointer, true); document.removeEventListener('pointercancel', cancelCancelledPointer, true); window.removeEventListener('blur', cancelOnScroll); document.removeEventListener('visibilitychange', cancelOnScroll); window.removeEventListener('pagehide', cancelOnScroll); cancelPending(); recognizedPointerRef.current = null; if (holdResetTimerRef.current) clearTimeout(holdResetTimerRef.current)
    }
  }, [cancelPending, interactive, kind, memoryId, reactionScopeKey, setPickerOpen])

  const eligible = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return false
    const target = event.target instanceof Element ? event.target : null
    return Boolean(target && articleRef.current && isHoldEligibleTarget(target, articleRef.current, event.clientX, event.clientY, kind))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!interactive || !eligible(event)) return
    cancelPending()
    if (holdResetTimerRef.current) { clearTimeout(holdResetTimerRef.current); holdResetTimerRef.current = null }
    recognizedPointerRef.current = null
    holdClickTargetRef.current = null
    didHoldRef.current = false
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target, pointerType: event.pointerType }
    timerRef.current = setTimeout(() => {
      const pointer = pointerRef.current
      if (!pointer || pointer.id !== event.pointerId) return
      didHoldRef.current = true
      recognizedPointerRef.current = { id: pointer.id, target: pointer.target }
      setPickerPoint({ x: pointer.x, y: pointer.y })
      if (!pickerOpenRef.current) onReactionFeedback?.('light')
      setPickerOpen(true)
    }, 500)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > HOLD_SLOP_PX) cancelPending()
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerRef.current?.id === event.pointerId) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      pointerRef.current = null
    }
  }
  const onCardClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!didHoldRef.current || event.detail === 0) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('.reaction-picker')) { didHoldRef.current = false; holdClickTargetRef.current = null; return }
    const holdTarget = holdClickTargetRef.current
    if (!holdTarget || (target !== holdTarget && !holdTarget.contains(target))) return
    didHoldRef.current = false
    holdClickTargetRef.current = null
    recognizedPointerRef.current = null
    event.preventDefault()
    event.stopPropagation()
  }
  const onCardKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.shiftKey && event.key === 'F10' && interactive && event.target === articleRef.current) {
      event.preventDefault()
      const rect = articleRef.current?.getBoundingClientRect()
      if (rect) { setPickerPoint({ x: Math.max(12, Math.min(rect.left + rect.width / 2, window.innerWidth - 12)), y: Math.max(12, rect.top + Math.min(80, rect.height / 2)) }); setPickerOpen(true) }
    }
  }

  return (
    <article aria-describedby={interactive ? `reaction-help-${memoryId}` : undefined} aria-hidden={mode === 'delete-preview' || isDeleteSource || undefined} className={`memory-card surface-raised${mode === 'delete-preview' ? ' memoly-memory-delete-preview' : ''}${isDeleteSource ? ' memoly-memory-delete-source' : ''}`} data-memory-id={memoryId} data-memory-kind={kind} data-reaction-enabled={interactive ? '' : undefined} onClickCapture={onCardClickCapture} onKeyDown={onCardKeyDown} onLostPointerCapture={cancelPending} onPointerCancel={cancelPending} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} ref={articleRef} tabIndex={interactive ? 0 : undefined}>
      {interactive ? <Typography as="span" className="sr-only" id={`reaction-help-${memoryId}`} variant="memoryMeta">Удерживайте свободную область, чтобы выбрать реакцию. Shift+F10 открывает выбор с клавиатуры.</Typography> : null}
      <header className="memory-header" data-slot="memoly-author-row">
        <FeedAuthorAvatar avatarPath={authorAvatarPath} avatarCrop={authorKind === 'channel' ? null : authorAvatarCrop} className={`author-avatar${authorKind === 'channel' ? ' publication-channel-avatar' : ''}`} name={authorName} fallback={authorKind === 'channel'
          ? <span aria-hidden="true" className="author-avatar publication-channel-avatar"><WebpIcon decorative name="channel" size={22} /></span>
          : <span aria-hidden="true" className="author-avatar"><Typography as="span" className="author-initials" variant="memoryMeta">{authorInitials}</Typography></span>} />
        <div className="author-meta"><Typography as="div" className="author-name" variant="memoryMeta">{authorName}</Typography><Typography as="div" className="author-time" tone="muted" variant="memoryMeta">{occurredTime}</Typography></div>
        <MemoryActions>{mode === 'delete-preview' ? null : actions}</MemoryActions>
      </header>
      {kind !== 'note' ? <MemorySlot className={kind === 'video' ? 'memory-media-slot video-wrap' : 'memory-media-slot'} contentRef={seenContentRef} slot={`memoly-${kind}-layout`}>{media}</MemorySlot> : null}
      {kind === 'note'
        ? <MemorySlot className="caption note-story-slot" contentRef={seenContentRef} ready={hasCaption} slot="memoly-note-layout">{hasCaption ? <NoteStoryPresentation body={body} interactive={interactive} onOpen={onOpen} /> : null}</MemorySlot>
        : kind === 'video'
          ? hasCaption ? <Typography className="caption" variant="memoryCaption">{body}</Typography> : null
          : hasCaption ? <div className="caption"><MemoryOpenButton body={body} interactive={interactive} kind={kind} onOpen={onOpen} /></div> : null}
      <MemoryReactions counts={reactionCounts ?? {}} current={currentUserReaction ?? null} interactive={interactive} onSelect={onReaction} onHaptic={onReactionFeedback} onOpenFromTrigger={(point) => { setPickerPoint(point); if (!pickerOpenRef.current) onReactionFeedback?.('light'); setPickerOpen(true) }} open={pickerOpen} point={pickerPoint} onOpenChange={setPickerOpen} returnFocusRef={articleRef} onComments={interactive ? onComments : undefined} commentCount={commentCount} />
    </article>
  )
}

function MemoryActions({ children }: { children: ReactNode }) { return <>{children}</> }

function MemorySlot({ children, className, contentRef, ready, slot }: { children: ReactNode; className?: string; contentRef?: Ref<HTMLDivElement>; ready?: boolean; slot: string }) {
  return <div className={className} data-seen-main="" data-seen-ready={ready === undefined ? undefined : String(ready)} data-slot={slot} ref={contentRef}>{children}</div>
}

function MemoryOpenButton({ body, interactive, kind, onOpen }: { body: string; interactive: boolean; kind: MemoryDto['kind']; onOpen: () => void }) {
  const content = body
  if (!interactive) return <Typography as="div" className="caption-open" variant="memoryCaption">{content}</Typography>
  return <Typography asChild variant="memoryCaption"><button aria-label={`Открыть воспоминание ${body || kind}`} className="caption-open" onClick={onOpen} type="button">{content}</button></Typography>
}
