import type { ReactNode } from 'react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import type { MemoryDto } from '@web-app-demo/contracts'

export type MemoryDeleteSpotlightProps = {
  error?: string | null
  memory: MemoryDto | null
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  preview: ReactNode
  submitting: boolean
}

/**
 * Reference implementation for the production app.
 *
 * Important:
 * - controlled by FeedPage
 * - does not clone/move DOM nodes
 * - preview is React-rendered and non-interactive
 * - remains open during mutation and on mutation error
 */
export function MemoryDeleteSpotlight({
  error,
  memory,
  onCancel,
  onConfirm,
  open,
  preview,
  submitting,
}: MemoryDeleteSpotlightProps) {
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onCancel()
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className="
            fixed inset-0 z-[80]
            bg-[rgb(31_42_44/48%)]
            backdrop-blur-[10px]
            data-open:animate-in data-open:fade-in-0
            data-closed:animate-out data-closed:fade-out-0
          "
        />

        <AlertDialogPrimitive.Content
          className="
            fixed inset-0 z-[81]
            flex flex-col items-center justify-center gap-3
            overflow-y-auto
            px-3
            py-[max(18px,var(--host-inset-top))]
            pb-[calc(18px+var(--host-inset-bottom))]
            outline-none
          "
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (submitting) event.preventDefault()
          }}
        >
          <div
            aria-hidden="true"
            className="
              pointer-events-none
              w-[min(92vw,420px)]
              max-h-[62dvh]
              overflow-hidden
              rounded-[var(--radius-card)]
              shadow-[0_26px_68px_rgb(25_35_37/32%)]
              data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95
            "
          >
            {preview}
          </div>

          <section
            className="
              w-[min(92vw,420px)]
              rounded-[var(--radius-sheet)]
              bg-popover
              px-4 pb-4 pt-4
              text-center
              shadow-[var(--shadow-card)]
            "
          >
            <AlertDialogPrimitive.Title asChild>
              <Typography as="h2" variant="memoryEmptyTitle">
                Удалить это воспоминание?
              </Typography>
            </AlertDialogPrimitive.Title>

            <AlertDialogPrimitive.Description asChild>
              <Typography className="mt-1.5" tone="muted" variant="memoryMeta">
                Оно исчезнет из семейной ленты.
              </Typography>
            </AlertDialogPrimitive.Description>

            {error ? (
              <Typography className="mt-2" role="alert" variant="memoryMeta">
                {error}
              </Typography>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <AlertDialogPrimitive.Cancel asChild>
                <Button disabled={submitting} type="button" variant="outline">
                  Отмена
                </Button>
              </AlertDialogPrimitive.Cancel>

              <Button
                disabled={submitting || !memory}
                onClick={onConfirm}
                type="button"
                variant="destructive"
              >
                {submitting ? 'Удаляем…' : 'Удалить'}
              </Button>
            </div>
          </section>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
