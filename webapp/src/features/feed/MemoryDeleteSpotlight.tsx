import type { ReactNode } from 'react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
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
 * The destructive action keeps the selected feed card in its original position
 * as context. The legacy preview prop remains part of the boundary for callers,
 * but the approved state presents only the centered confirmation modal.
 */
export function MemoryDeleteSpotlight({ error, memory, onCancel, onConfirm, open, submitting }: MemoryDeleteSpotlightProps) {
  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onCancel()
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="memoly-delete-overlay" />
        <AlertDialogPrimitive.Content
          aria-describedby="memoly-delete-description"
          aria-labelledby="memoly-delete-title"
          className="memoly-delete-content"
          onEscapeKeyDown={(event) => {
            if (submitting) event.preventDefault()
          }}
        >
          <section className="memory-confirm-modal memoly-delete-panel">
            <div className="memory-confirm-icon"><WebpIcon decorative name="warning" size={26} state="active" /></div>
            <AlertDialogPrimitive.Title asChild>
              <Typography as="h2" id="memoly-delete-title" variant="memoryEmptyTitle">Удалить воспоминание?</Typography>
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description asChild>
              <Typography className="memoly-delete-description" id="memoly-delete-description" tone="muted" variant="memoryMeta">Оно исчезнет из семейной ленты.</Typography>
            </AlertDialogPrimitive.Description>
            {error ? <Typography className="memoly-delete-error" role="alert" variant="memoryMeta">{error}</Typography> : null}
            <div className="memoly-delete-actions">
              <Button className="memory-confirm-cancel" disabled={submitting} onClick={onCancel} type="button" variant="outline">Отмена</Button>
              <Button className="memory-confirm-delete" disabled={submitting || !memory} onClick={onConfirm} type="button" variant="destructive">{submitting ? 'Удаляем…' : 'Удалить'}</Button>
            </div>
          </section>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
