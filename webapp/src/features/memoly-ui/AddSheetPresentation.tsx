import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react'

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
    <div className="memoly-sheet-content memoly-add-sheet-panel" data-slot="memoly-add-sheet-panel" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <DrawerTitle className="sheet-title" id="memoly-add-sheet-title">Добавить воспоминание</DrawerTitle>
      <DrawerDescription className="sheet-subtitle" id="memoly-add-sheet-description">Сохраняйте моменты, которые важны</DrawerDescription>
      <div className="add-options">
        <AddAction icon="photo" label="Добавить фото" name="photo" onClick={onPhoto} copy={<>Снимок<br />из жизни</>} />
        <AddAction icon="note" label="Добавить заметку" name="note" onClick={onNote} copy={<>Мысли<br />и события</>} />
        <AddAction icon="voice" label="Добавить голос или видео" name="voice-or-video" onClick={onVoiceOrVideo} copy={<>Файл<br />с устройства</>} />
      </div>
    </div>
  )
}

function AddAction({ icon, label, name, onClick, copy }: { icon: 'note' | 'photo' | 'voice' | 'video'; label: string; name: 'note' | 'photo' | 'video' | 'voice-or-video'; onClick: () => void; copy: ReactNode }) {
  const kind = name === 'photo' ? 'kind-photo' : name === 'note' ? 'kind-note' : 'kind-media'
  return <button aria-label={label} className={`add-option ${kind}`} data-add-action={name} onClick={onClick} type="button">
    <span className="add-option-icon"><WebpIcon decorative name={icon} size={38} state="active" /></span>
    <Typography as="span" className="add-option-title" variant="memoryBodyMedium">{name === 'photo' ? 'Фото' : name === 'note' ? 'Заметка' : name === 'video' ? 'Видео' : 'Голос или видео'}</Typography>
    <Typography as="span" className="add-option-copy" tone="muted" variant="memoryMeta">{copy}</Typography>
  </button>
}

export function VoiceOrVideoAction({ onClick }: { onClick: () => void }) {
  return AddAction({ copy: <>Файл<br />с устройства</>, icon: 'voice', label: 'Голос или видео', name: 'voice-or-video', onClick })
}

export function MediaChoiceAction({ icon, label, name, onClick, title, copy }: {
  icon: 'voice' | 'video'
  label: string
  name: 'audio' | 'video'
  onClick: () => void
  title: string
  copy: ReactNode
}) {
  return <button aria-label={label} className="media-choice-card" data-add-action={name} onClick={onClick} type="button">
    <span className="media-choice-icon"><WebpIcon decorative name={icon} size={34} state="active" /></span>
    <span className="media-choice-copy">
      <Typography as="strong" variant="memoryBodyMedium">{title}</Typography>
      <Typography as="span" tone="muted" variant="memoryMeta">{copy}</Typography>
    </span>
    <WebpIcon decorative name="chevron" size={22} />
  </button>
}

export function VoiceOrVideoPanel({ onBack, onClose, onVideo }: { onBack: () => void; onClose: () => void; onVideo: () => void }) {
  return <div aria-describedby="memoly-voice-video-description" className="memoly-sheet-content" data-slot="memoly-voice-video-sheet">
    <div className="flex min-h-11 items-center gap-3">
      <Button aria-label="Назад" className="size-11" onClick={onBack} size="icon" type="button" variant="ghost"><WebpIcon decorative name="chevron" size={24} /></Button>
      <DrawerTitle className="min-w-0 flex-1 text-left"><Typography as="span" variant="memoryEmptyTitle">Добавить голос или видео</Typography></DrawerTitle>
      <Button aria-label="Закрыть" className="size-11" onClick={onClose} size="icon" type="button" variant="ghost"><WebpIcon decorative name="close" size={24} /></Button>
    </div>
    <div className="media-choice-body">
      <MediaChoiceAction copy={<>Готовый видеофайл<br />с устройства</>} icon="video" label="Выбрать видео" name="video" onClick={onVideo} title="Выбрать видео" />
      <div className="media-choice-card memoly-voice-handoff" data-add-action="audio"><span className="media-choice-icon"><WebpIcon decorative name="voice" size={34} state="active" /></span><span className="media-choice-copy"><Typography as="strong" variant="memoryBodyMedium">Голосовые — через бот</Typography><Typography as="span" tone="muted" variant="memoryMeta">Добавление аудио в приложении пока недоступно</Typography><a href="https://t.me/OurMemoriesDevBot"><Typography as="span" variant="memoryButton">Открыть бота</Typography></a></span></div>
    </div>
    <DrawerDescription className="mt-4 text-left" id="memoly-voice-video-description"><Typography as="span" variant="memoryMeta">Материалы увидят участники вашей семьи</Typography></DrawerDescription>
  </div>
}

// These presentation boundaries are intentionally kept isolated until T09 supplies real create flows.
export function PhotoAddPresentation({ onSelect }: { onSelect?: () => void } = {}) {
  return <AddAction copy={<>Снимок<br />из жизни</>} icon="photo" label="Фото" name="photo" onClick={onSelect ?? noop} />
}

export function NoteAddPresentation({ onSelect }: { onSelect?: () => void } = {}) {
  return <AddAction copy={<>Мысли<br />и события</>} icon="note" label="Заметка" name="note" onClick={onSelect ?? noop} />
}

function noop() {}

export const PhotoAddCard = PhotoAddPresentation
export const NoteAddForm = NoteAddPresentation
