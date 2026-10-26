import type { ReactNode, RefObject } from 'react'

import { Drawer, DrawerContent } from '@/components/ui/drawer'

export type MemolyBottomSheetProps = {
  children: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  dismissible?: boolean
  /** Keep a nested sheet within its parent modal’s focus scope when supplied. */
  portalContainer?: HTMLElement | null
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * Shared behavioural and visual shell for memoLy sheets. Feature components own their
 * state/content while this wrapper keeps a single modal layer with the required mobile
 * safe-area and tactile geometry.
 */
export function MemolyBottomSheet({ children, onOpenChange, open, returnFocusRef, dismissible = true, portalContainer, onCloseAutoFocus }: MemolyBottomSheetProps) {
  return (
    <Drawer autoFocus dismissible={dismissible} onOpenChange={onOpenChange} open={open} shouldScaleBackground={false}>
      <DrawerContent
        portalContainer={portalContainer}
        className="mx-auto max-w-[var(--layout-max-width)] border-0 bg-[var(--memory-surface)] bg-[image:var(--memory-surface-raised)] shadow-[var(--memory-sheet-shadow)]"
        data-memoly-bottom-sheet="true"
        showHandle={false}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          if (!returnFocusRef?.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <MemolyBottomSheetPanel>{children}</MemolyBottomSheetPanel>
      </DrawerContent>
    </Drawer>
  )
}

export function MemolyBottomSheetPanel({ children }: { children: ReactNode }) {
  return <>
    <div aria-hidden="true" className="mx-auto h-1 w-[38px] shrink-0 rounded-full bg-[var(--memory-surface-inset)] shadow-[var(--memory-inset-shadow)]" data-slot="memoly-bottom-sheet-handle" />
    <div className="memoly-bottom-sheet-body">{children}</div>
  </>
}
