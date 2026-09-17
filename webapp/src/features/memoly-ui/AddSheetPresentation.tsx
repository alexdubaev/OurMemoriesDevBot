import { useCallback, useEffect, type RefObject } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer'

const historyMarker = 'our-memories:add-sheet'

export type AddSheetPresentationProps = {
  hostBridge: { openBot: () => void }
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  role: 'full' | 'viewer'
}

export function AddSheetPresentation({
  hostBridge,
  onOpenChange,
  open,
  returnFocusRef,
  role,
}: AddSheetPresentationProps) {
  const close = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.memorySheet === historyMarker) {
      window.history.back()
      return
    }
    onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    if (role !== 'full' || !open || typeof window === 'undefined') return undefined

    window.history.pushState(
      { ...window.history.state, memorySheet: historyMarker },
      '',
      window.location.href,
    )
    const closeOnBack = () => onOpenChange(false)
    window.addEventListener('popstate', closeOnBack)
    return () => window.removeEventListener('popstate', closeOnBack)
  }, [onOpenChange, open, role])

  if (role !== 'full') return null

  return (
    <Drawer
      autoFocus
      dismissible
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
      open={open}
      shouldScaleBackground={false}
    >
      <DrawerContent
        aria-describedby="memoly-add-sheet-description"
        className="mx-auto max-w-[var(--layout-max-width)] border-0"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <AddSheetPanel
          onClose={close}
          onOpenBot={() => {
            hostBridge.openBot()
            close()
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}

export function AddSheetPanel({
  onClose,
  onOpenBot,
}: {
  onClose: () => void
  onOpenBot: () => void
}) {
  return (
    <div className="px-5 pb-[calc(1.25rem+var(--host-inset-bottom))] pt-3" data-slot="memoly-add-sheet-panel">
      <div className="flex min-h-11 items-center gap-3">
        <DrawerTitle className="min-w-0 flex-1 text-left">
          <Typography as="span" variant="memoryEmptyTitle">Что добавить?</Typography>
        </DrawerTitle>
        <Button aria-label="Закрыть" className="size-11" onClick={onClose} size="icon" type="button" variant="ghost">
          <WebpIcon decorative name="close" size={24} />
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <VoiceOrVideoAction onClick={onOpenBot} />
      </div>
      <DrawerDescription className="mt-4 text-left" id="memoly-add-sheet-description">
        <Typography as="span" variant="memoryMeta">Материалы увидят участники вашей семьи</Typography>
      </DrawerDescription>
    </div>
  )
}

export function VoiceOrVideoAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="Голос или видео"
      className="flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-field)] bg-muted px-3 text-left transition-colors duration-[var(--duration-standard)] hover:bg-accent"
      data-add-action="voice-or-video"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card">
        <WebpIcon decorative name="voice" size={22} state="active" />
      </span>
      <Typography className="min-w-0 flex-1" variant="memoryBodyMedium">Голос или видео</Typography>
      <WebpIcon decorative name="chevron" size={22} />
    </button>
  )
}

// These presentation boundaries are intentionally kept isolated until T09 supplies real create flows.
export function PhotoAddPresentation({ onSelect }: { onSelect?: () => void } = {}) {
  return <DeferredAddAction icon="photo" label="Фото или видео" onSelect={onSelect} />
}

export function NoteAddPresentation({ onSelect }: { onSelect?: () => void } = {}) {
  return <DeferredAddAction icon="note" label="Заметка" onSelect={onSelect} />
}

function DeferredAddAction({
  icon,
  label,
  onSelect,
}: {
  icon: 'note' | 'photo'
  label: string
  onSelect?: () => void
}) {
  return (
    <button
      aria-label={label}
      className="flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-field)] bg-muted px-3 text-left"
      data-add-action="deferred"
      onClick={onSelect}
      type="button"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card">
        <WebpIcon decorative name={icon} size={22} state="active" />
      </span>
      <Typography className="min-w-0 flex-1" variant="memoryBodyMedium">{label}</Typography>
    </button>
  )
}

export const PhotoAddCard = PhotoAddPresentation
export const NoteAddForm = NoteAddPresentation
