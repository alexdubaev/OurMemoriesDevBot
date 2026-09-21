import type { ReactNode, RefObject } from 'react'

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

export type MemolyBottomSheetProps = {
  children: ReactNode
  description?: ReactNode
  onOpenChange: (open: boolean) => void
  open: boolean
  returnFocusRef?: RefObject<HTMLElement | null>
  title?: ReactNode
}

/**
 * One memoLy sheet shell.
 *
 * Use for:
 * - Add
 * - Memory actions
 * - Settings/help action lists
 *
 * Do not fork backdrop/panel/handle styles in feature code.
 */
export function MemolyBottomSheet({
  children,
  description,
  onOpenChange,
  open,
  returnFocusRef,
  title,
}: MemolyBottomSheetProps) {
  return (
    <Drawer
      dismissible
      onOpenChange={onOpenChange}
      open={open}
      shouldScaleBackground={false}
    >
      <DrawerContent
        className={cn(
          'mx-auto max-w-[var(--layout-max-width)] border-0',
          'bg-popover/95 backdrop-blur-xl',
          'shadow-[0_-16px_38px_rgb(74_91_81/17%)]',
        )}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current
          if (!target) return
          event.preventDefault()
          target.focus()
        }}
      >
        <div className="px-3 pb-[calc(1rem+var(--host-inset-bottom))] pt-1">
          {title ? (
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
          ) : null}

          {description ? (
            <DrawerDescription className="sr-only">
              {description}
            </DrawerDescription>
          ) : null}

          {children}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
