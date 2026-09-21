import { useState } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { createIdempotencyKey, createNoteMemory } from './api'
import { ComposerForm } from './ComposerForm'
import { composerInitialDate } from './date'

export type NoteComposerProps = {
  childId: string
  familyId: string
  familyTimezone: string
  transport: AuthenticatedTransport
  onCancel: () => void
  onSuccess: () => void | Promise<void>
}

export function NoteComposer({ childId, familyId, familyTimezone, transport, onCancel, onSuccess }: NoteComposerProps) {
  const [idempotencyKey] = useState(() => createIdempotencyKey())
  return <NoteComposerForm childId={childId} familyId={familyId} familyTimezone={familyTimezone} idempotencyKey={idempotencyKey} onCancel={onCancel} onSuccess={onSuccess} transport={transport} />
}

function NoteComposerForm({ childId, familyId, familyTimezone, idempotencyKey, onCancel, onSuccess, transport }: NoteComposerProps & { idempotencyKey: string }) {
  return <ComposerForm
    description="Запишите важный момент для семейной ленты."
    familyTimezone={familyTimezone}
    initialBody=""
    initialDate={composerInitialDate(familyTimezone)}
    onCancel={onCancel}
    onSuccess={onSuccess}
    requireBody
    save={(body, occurredAt, signal) => createNoteMemory(transport, familyId, { childId, body, occurredAt, idempotencyKey }, signal)}
    title="Новая заметка"
  />
}
