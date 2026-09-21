import { useCallback, useEffect, useState, type RefObject } from 'react'

import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { WebpIcon } from '@/components/WebpIcon'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { subscribeAddSheetBack } from './add-sheet-back'
import type { HostBridge } from '@/platform/host-bridge'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import '@/styles/composer-skin.css'

const historyMarker = 'our-memories:add-sheet'

export type AddSheetPresentationProps = {
  hostBridge: Pick<HostBridge, 'onBack'>
  onNote: () => void
  onOpenChange: (open: boolean) => void
  onPhoto: () => void
  onVideo: () => void
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  role: 'full' | 'viewer'
}

export function AddSheetPresentation({
  hostBridge,
  onNote,
  onOpenChange,
  onPhoto,
  onVideo,
  open,
  returnFocusRef,
  role,
}: AddSheetPresentationProps) {
  const [level, setLevel] = useState<'add' | 'voice-video'>('add')
  const close = useCallback(() => {
    setLevel('add')
    onOpenChange(false)
    if (typeof window !== 'undefined' && window.history.state?.memorySheet === historyMarker) {
      window.history.back()
    }
  }, [onOpenChange])

  useEffect(() => {
    if (role !== 'full' || !open || typeof window === 'undefined') return undefined

    window.history.pushState(
      { ...window.history.state, memorySheet: historyMarker },
      '',
      window.location.href,
    )
    const closeOnHistoryBack = () => {
      setLevel('add')
      onOpenChange(false)
    }
    const closeOnHostBack = () => close()
    window.addEventListener('popstate', closeOnHistoryBack)
    const unsubscribeHostBack = subscribeAddSheetBack(hostBridge, closeOnHostBack)
    return () => {
      window.removeEventListener('popstate', closeOnHistoryBack)
      unsubscribeHostBack()
    }
  }, [close, hostBridge, onOpenChange, open, role])

  if (role !== 'full') return null

  return (
    <MemolyBottomSheet onOpenChange={(nextOpen) => { if (!nextOpen) close() }} open={open} returnFocusRef={returnFocusRef}>
      {level === 'add' ? <AddSheetPanel
        onClose={close}
        onNote={() => { close(); onNote() }}
        onPhoto={() => { close(); onPhoto() }}
        onVoiceOrVideo={() => setLevel('voice-video')}
      /> : <VoiceOrVideoPanel
        onBack={() => setLevel('add')}
        onClose={close}
        onVideo={() => { close(); onVideo() }}
      />}
    </MemolyBottomSheet>
  )
}

export function AddSheetPanel({
  onClose,
  onNote,
  onPhoto,
  onVoiceOrVideo,
}: {
  onClose: () => void
  onNote: () => void
  onPhoto: () => void
  onVoiceOrVideo: () => void
}) {
  return (
    <div className="memoly-sheet-content" data-slot="memoly-add-sheet-panel">
      <div className="flex min-h-11 items-center gap-3">
        <DrawerTitle className="min-w-0 flex-1 text-left">
          <Typography as="span" variant="memoryEmptyTitle">Что добавить?</Typography>
        </DrawerTitle>
        <Button aria-label="Закрыть" className="size-11" onClick={onClose} size="icon" type="button" variant="ghost">
          <WebpIcon decorative name="close" size={24} />
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <AddAction icon="photo" label="Фото" name="photo" onClick={onPhoto} />
        <AddAction icon="note" label="Заметка" name="note" onClick={onNote} />
        <VoiceOrVideoAction onClick={onVoiceOrVideo} />
      </div>
      <DrawerDescription className="mt-4 text-left" id="memoly-add-sheet-description">
        <Typography as="span" variant="memoryMeta">Материалы увидят участники вашей семьи</Typography>
      </DrawerDescription>
    </div>
  )
}

function AddAction({ icon, label, name, onClick }: { icon: 'note' | 'photo' | 'video'; label: string; name: 'note' | 'photo' | 'video'; onClick: () => void }) {
  return <button
    aria-label={label}
    className="memoly-sheet-action flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-field)] px-3 text-left transition-colors duration-[var(--duration-standard)]"
    data-add-action={name}
    onClick={onClick}
    type="button"
  >
    <span className="memoly-sheet-action-icon flex size-9 shrink-0 items-center justify-center rounded-full"><WebpIcon decorative name={icon} size={22} state="active" /></span>
    <Typography className="min-w-0 flex-1" variant="memoryBodyMedium">{label}</Typography>
    <WebpIcon decorative name="chevron" size={22} />
  </button>
}

export function VoiceOrVideoAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="Голос или видео"
      className="memoly-sheet-action flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-field)] px-3 text-left transition-colors duration-[var(--duration-standard)]"
      data-add-action="voice-or-video"
      onClick={onClick}
      type="button"
    >
      <span className="memoly-sheet-action-icon flex size-9 shrink-0 items-center justify-center rounded-full">
        <WebpIcon decorative name="voice" size={22} state="active" />
      </span>
      <Typography className="min-w-0 flex-1" variant="memoryBodyMedium">Голос или видео</Typography>
      <WebpIcon decorative name="chevron" size={22} />
    </button>
  )
}

function VoiceOrVideoPanel({ onBack, onClose, onVideo }: { onBack: () => void; onClose: () => void; onVideo: () => void }) {
  const [voiceNotice, setVoiceNotice] = useState(false)
  return <div aria-describedby="memoly-voice-video-description" className="memoly-sheet-content" data-slot="memoly-voice-video-sheet">
    <div className="flex min-h-11 items-center gap-3">
      <Button aria-label="Назад" className="size-11" onClick={onBack} size="icon" type="button" variant="ghost"><WebpIcon decorative name="chevron" size={24} /></Button>
      <DrawerTitle className="min-w-0 flex-1 text-left"><Typography as="span" variant="memoryEmptyTitle">Голос или видео</Typography></DrawerTitle>
      <Button aria-label="Закрыть" className="size-11" onClick={onClose} size="icon" type="button" variant="ghost"><WebpIcon decorative name="close" size={24} /></Button>
    </div>
    <div className="mt-4 flex flex-col gap-2">
      <AddAction icon="video" label="Видео" name="video" onClick={onVideo} />
      <button aria-label="Голос" className="memoly-sheet-action flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-field)] px-3 text-left transition-colors duration-[var(--duration-standard)]" data-add-action="voice" onClick={() => setVoiceNotice(true)} type="button">
        <span className="memoly-sheet-action-icon flex size-9 shrink-0 items-center justify-center rounded-full"><WebpIcon decorative name="voice" size={22} state="active" /></span>
        <Typography className="min-w-0 flex-1" variant="memoryBodyMedium">Голос</Typography>
      </button>
    </div>
    {voiceNotice ? <Typography aria-live="polite" className="mt-4" variant="memoryMeta">Запись голоса появится позже. Пока можно отправить голосовое в бот.</Typography> : null}
    <DrawerDescription className="mt-4 text-left" id="memoly-voice-video-description"><Typography as="span" variant="memoryMeta">Материалы увидят участники вашей семьи</Typography></DrawerDescription>
  </div>
}

// These presentation boundaries are intentionally kept isolated until T09 supplies real create flows.
export function PhotoAddPresentation({ onSelect }: { onSelect?: () => void } = {}) {
  return <AddAction icon="photo" label="Фото" name="photo" onClick={onSelect ?? noop} />
}

export function NoteAddPresentation({ onSelect }: { onSelect?: () => void } = {}) {
  return <AddAction icon="note" label="Заметка" name="note" onClick={onSelect ?? noop} />
}

function noop() {}

export const PhotoAddCard = PhotoAddPresentation
export const NoteAddForm = NoteAddPresentation
