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
 * The destructive action keeps the selected memory visible as context. The card
 * is rendered by React in `preview`; the original feed card remains in place
 * and is hidden with visibility while this controlled dialog is open.
 */
export function MemoryDeleteSpotlight({ error, memory, onCancel, onConfirm, open, preview, submitting }: MemoryDeleteSpotlightProps) {
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
          <Typography as="div" aria-hidden="true" className="memoly-delete-preview" variant="memoryBody">{preview}</Typography>
          <section className="memoly-delete-panel">
            <AlertDialogPrimitive.Title asChild>
              <Typography as="h2" id="memoly-delete-title" variant="memoryEmptyTitle">Удалить это воспоминание?</Typography>
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description asChild>
              <Typography className="memoly-delete-description" id="memoly-delete-description" tone="muted" variant="memoryMeta">Оно исчезнет из семейной ленты.</Typography>
            </AlertDialogPrimitive.Description>
            {error ? <Typography className="memoly-delete-error" role="alert" variant="memoryMeta">{error}</Typography> : null}
            <div className="memoly-delete-actions">
              <Button disabled={submitting} onClick={onCancel} type="button" variant="outline">Отмена</Button>
              <Button disabled={submitting || !memory} onClick={onConfirm} type="button" variant="destructive">{submitting ? 'Удаляем…' : 'Удалить'}</Button>
            </div>
          </section>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
