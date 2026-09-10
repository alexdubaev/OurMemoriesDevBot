import { useCallback, useEffect, type RefObject } from 'react'

import { WebpIcon, type WebpIconName } from '@/components/WebpIcon'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer'
import { uiCopy } from '@/content/ui-copy'

const historyMarker = 'our-memories:add-sheet'

const addActions: ReadonlyArray<{
  icon: WebpIconName
  key: 'media' | 'note' | 'voice'
  label: string
}> = [
  { icon: 'photo', key: 'media', label: uiCopy['add.media'] },
  { icon: 'note', key: 'note', label: uiCopy['add.note'] },
  { icon: 'voice', key: 'voice', label: uiCopy['add.voice'] },
]

export type AddSheetProps = {
  onOpenChange: (open: boolean) => void
  onSelect?: (kind: 'media' | 'note' | 'voice') => void
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function AddSheet({
  onOpenChange,
  onSelect,
  open,
  returnFocusRef,
}: AddSheetProps) {
  const close = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.memorySheet === historyMarker) {
      window.history.back()
      return
    }
    onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined

    window.history.pushState(
      { ...window.history.state, memorySheet: historyMarker },
      '',
      window.location.href,
    )
    const closeOnBack = () => onOpenChange(false)
    window.addEventListener('popstate', closeOnBack)
    return () => window.removeEventListener('popstate', closeOnBack)
  }, [onOpenChange, open])

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
        aria-describedby="add-sheet-description"
        className="mx-auto max-w-[var(--layout-max-width)] border-0"
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <AddSheetPanel
          onClose={close}
          onSelect={(kind) => {
            onSelect?.(kind)
            close()
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}

export function AddSheetPanel({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect?: (kind: 'media' | 'note' | 'voice') => void
}) {
  return (
    <div className="px-5 pb-[calc(1.25rem+var(--host-inset-bottom))] pt-3" data-slot="add-sheet-panel">
      <div className="flex min-h-11 items-center gap-3">
        <DrawerTitle className="min-w-0 flex-1 text-left">
          <Typography as="span" variant="memoryEmptyTitle">{uiCopy['add.title']}</Typography>
        </DrawerTitle>
        <Button aria-label="Закрыть" className="size-11" onClick={onClose} size="icon" type="button" variant="ghost">
          <WebpIcon decorative name="close" size={24} />
        </Button>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {addActions.map((action) => (
          <button
            className="flex min-h-[60px] w-full items-center gap-3 rounded-[var(--radius-field)] bg-muted px-3 text-left transition-colors duration-[var(--duration-standard)] hover:bg-accent"
            data-add-action={action.key}
            key={action.key}
            onClick={() => onSelect?.(action.key)}
            type="button"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card">
              <WebpIcon decorative name={action.icon} size={22} state="active" />
            </span>
            <Typography className="min-w-0 flex-1" variant="memoryBodyMedium">
              {action.label}
            </Typography>
            <WebpIcon decorative name="chevron" size={22} />
          </button>
        ))}
      </div>
      <DrawerDescription className="mt-4 text-left" id="add-sheet-description">
        <Typography as="span" variant="memoryMeta">{uiCopy['add.visibility']}</Typography>
      </DrawerDescription>
    </div>
  )
}
