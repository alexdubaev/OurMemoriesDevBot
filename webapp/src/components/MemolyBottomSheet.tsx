import type { ReactNode, RefObject } from 'react'

import { Drawer, DrawerContent } from '@/components/ui/drawer'

export type MemolyBottomSheetProps = {
  children: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Shared behavioural and visual shell for memoLy sheets. Feature components own their
 * state/content while this wrapper keeps a single modal layer with the required mobile
 * safe-area and tactile geometry.
 */
export function MemolyBottomSheet({ children, onOpenChange, open, returnFocusRef }: MemolyBottomSheetProps) {
  return (
    <Drawer autoFocus dismissible onOpenChange={onOpenChange} open={open} shouldScaleBackground={false}>
      <DrawerContent
        className="mx-auto max-w-[var(--layout-max-width)] border-0 bg-[var(--memory-surface)] bg-[image:var(--memory-surface-raised)] shadow-[var(--memory-sheet-shadow)]"
        data-memoly-bottom-sheet="true"
        showHandle={false}
        onCloseAutoFocus={(event) => {
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
