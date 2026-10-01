import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from 'react'
import type { MemoryDto, MemoryReaction } from '@web-app-demo/contracts'

import { Typography } from '@/components/typography'
import type { ChildAvatarCrop } from '@/components/ChildHeader'
import { MemberAvatarImage } from '@/features/avatar'
import { NoteStoryPresentation } from './NoteStoryPresentation'
import { MemoryReactions } from './MemoryReactions'
import type { ReactionHapticStyle } from '@/platform/reaction-haptics'

export type MemoryCardPresentationProps = {
  actions: ReactNode
  authorInitials: string
  authorName: string
  authorAvatarPath?: string | null
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
}

export function MemoryCardPresentation({
  actions,
  authorInitials,
  authorName,
  authorAvatarPath,
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
}: MemoryCardPresentationProps) {
  const hasCaption = body.trim().length > 0
  const interactive = mode === 'feed'
  const articleRef = useRef<HTMLElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerRef = useRef<{ id: number; x: number; y: number; target: EventTarget | null } | null>(null)
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
      if (pointer && pointer.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) cancelPending()
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
    document.addEventListener('pointerdown', clearReleasedHoldLatch, true)
    document.addEventListener('pointerdown', cancelOtherPointer, true)
    document.addEventListener('pointermove', cancelOnGlobalMove, true)
    document.addEventListener('pointerup', cancelReleasedPointer, true)
    document.addEventListener('pointercancel', cancelCancelledPointer, true)
    window.addEventListener('blur', cancelOnScroll)
    document.addEventListener('visibilitychange', cancelOnScroll)
    window.addEventListener('pagehide', cancelOnScroll)
    return () => { document.removeEventListener('scroll', cancelOnScroll, true); document.removeEventListener('pointerdown', clearReleasedHoldLatch, true); document.removeEventListener('pointerdown', cancelOtherPointer, true); document.removeEventListener('pointermove', cancelOnGlobalMove, true); document.removeEventListener('pointerup', cancelReleasedPointer, true); document.removeEventListener('pointercancel', cancelCancelledPointer, true); window.removeEventListener('blur', cancelOnScroll); document.removeEventListener('visibilitychange', cancelOnScroll); window.removeEventListener('pagehide', cancelOnScroll); cancelPending(); recognizedPointerRef.current = null; if (holdResetTimerRef.current) clearTimeout(holdResetTimerRef.current) }
  }, [cancelPending, memoryId, reactionScopeKey, setPickerOpen])

  const eligible = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return false
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest('[data-reaction-result], [data-slot="memory-actions"], a, input, select, textarea, [contenteditable="true"]')) return false
    const note = target.closest('[data-memoly-note-gradient]')
    if (note) {
      const text = note.querySelector('.memoly-note-gradient__text')
      if (text && target.closest('.memoly-note-gradient__text')) return false
      if (text) {
        const rect = text.getBoundingClientRect()
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return false
      }
      return true
    }
    const media = target.closest('.memory-media-slot, .memoly-mixed-slide-media')
    if (media) {
      const videoSurface = kind === 'video' || target.closest('[data-media-kind="video"]') !== null
      if (target.closest('.ml-media-button')) return !videoSurface
      if (target.closest('.memoly-private-video-v2-controls, .memoly-video-viewer-v2-controls, .memoly-mixed-controls, [data-slot="voice-waveform"], .ml-audio button, .ml-audio input, .voice-control')) return false
      const posterButton = target.closest('button[aria-label="Смотреть видео"], button[aria-label="Смотреть видео в Telegram"]')
      if (posterButton) {
        const rect = posterButton.getBoundingClientRect()
        if (Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2)) < 48) return false
        if (event.clientY > rect.bottom - 48 && event.clientX > rect.right - 76) return false
        return true
      }
      if (target.closest('button, input, [role="button"]')) return false
      const video = target.closest('video')
      if (video) {
        const rect = video.getBoundingClientRect()
        if (event.clientY > rect.bottom - 44) return false
        return true
      }
      if (target.closest('audio')) return false
      return target.closest('img, .memoly-private-video-v2-frame, .memoly-video-viewer-v2-frame, .memoly-mixed-slide, .ml-audio, .memoly-private-video-v2, .memoly-video-viewer-v2') !== null
    }
    if (target.closest('button, video, audio, [role="button"]')) return false
    return Boolean(articleRef.current?.contains(target))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!interactive || !eligible(event)) return
    cancelPending()
    if (holdResetTimerRef.current) { clearTimeout(holdResetTimerRef.current); holdResetTimerRef.current = null }
    recognizedPointerRef.current = null
    holdClickTargetRef.current = null
    didHoldRef.current = false
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target }
    timerRef.current = setTimeout(() => {
      const pointer = pointerRef.current
      if (!pointer || pointer.id !== event.pointerId) return
      const selection = document.getSelection()
      const noteText = (pointer.target instanceof Element ? pointer.target : null)?.closest('.memoly-note-gradient__text')
      if (selection && !selection.isCollapsed && noteText && selection.anchorNode && selection.focusNode && noteText.contains(selection.anchorNode) && noteText.contains(selection.focusNode)) { cancelPending(); return }
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
    if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) cancelPending()
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
    <article aria-describedby={interactive ? `reaction-help-${memoryId}` : undefined} aria-hidden={mode === 'delete-preview' || isDeleteSource || undefined} className={`memory-card surface-raised${mode === 'delete-preview' ? ' memoly-memory-delete-preview' : ''}${isDeleteSource ? ' memoly-memory-delete-source' : ''}`} data-memory-id={memoryId} data-memory-kind={kind} onClickCapture={onCardClickCapture} onKeyDown={onCardKeyDown} onLostPointerCapture={cancelPending} onPointerCancel={cancelPending} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} ref={articleRef} tabIndex={interactive ? 0 : undefined}>
      {interactive ? <Typography as="span" className="sr-only" id={`reaction-help-${memoryId}`} variant="memoryMeta">Удерживайте свободную область, чтобы выбрать реакцию. Shift+F10 открывает выбор с клавиатуры.</Typography> : null}
      <header className="memory-header" data-slot="memoly-author-row">
        <MemberAvatarImage avatarPath={authorAvatarPath} className="author-avatar" name={authorName} fallback={<span aria-hidden="true" className="author-avatar"><Typography as="span" className="author-initials" variant="memoryMeta">{authorInitials}</Typography></span>} />
        <div className="author-meta"><Typography as="div" className="author-name" variant="memoryMeta">{authorName}</Typography><Typography as="div" className="author-time" tone="muted" variant="memoryMeta">{occurredTime}</Typography></div>
        <MemoryActions>{mode === 'delete-preview' ? null : actions}</MemoryActions>
      </header>
      {kind !== 'note' ? <MemorySlot className={kind === 'video' ? 'memory-media-slot video-wrap' : 'memory-media-slot'} contentRef={seenContentRef} slot={`memoly-${kind}-layout`}>{media}</MemorySlot> : null}
      {kind === 'note'
        ? <MemorySlot className="caption note-story-slot" contentRef={seenContentRef} ready={hasCaption} slot="memoly-note-layout">{hasCaption ? <NoteStoryPresentation body={body} interactive={interactive} onOpen={onOpen} /> : null}</MemorySlot>
        : kind === 'video'
          ? hasCaption ? <Typography className="caption" variant="memoryCaption">{body}</Typography> : null
          : hasCaption ? <div className="caption"><MemoryOpenButton body={body} interactive={interactive} kind={kind} onOpen={onOpen} /></div> : null}
      <MemoryReactions counts={reactionCounts ?? {}} current={currentUserReaction ?? null} interactive={interactive} onSelect={onReaction} onHaptic={onReactionFeedback} open={pickerOpen} point={pickerPoint} onOpenChange={setPickerOpen} returnFocusRef={articleRef} />
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
