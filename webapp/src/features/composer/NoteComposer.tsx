import { useRef, useState } from 'react'

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
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey())
  return <NoteComposerForm childId={childId} familyId={familyId} familyTimezone={familyTimezone} idempotencyKey={idempotencyKey} key={idempotencyKey} onAddAnother={() => setIdempotencyKey(createIdempotencyKey())} onCancel={onCancel} onSuccess={onSuccess} transport={transport} />
}

function NoteComposerForm({ childId, familyId, familyTimezone, idempotencyKey, onAddAnother, onCancel, onSuccess, transport }: NoteComposerProps & { idempotencyKey: string; onAddAnother: () => void }) {
  const submission = useRef<{ body: string; occurredAt: string; key: string } | null>(null)
  return <ComposerForm
    addPresentation
    description="Запишите важный момент для семейной ленты."
    familyTimezone={familyTimezone}
    initialBody=""
    initialDate={composerInitialDate(familyTimezone)}
    onCancel={onCancel}
    onAddAnother={onAddAnother}
    onSuccess={onSuccess}
    requireBody
    save={(body, occurredAt, signal) => {
      const previous = submission.current
      const key = previous?.body === body && previous.occurredAt === occurredAt
        ? previous.key
        : previous ? createIdempotencyKey() : idempotencyKey
      submission.current = { body, occurredAt, key }
      return createNoteMemory(transport, familyId, { childId, body, occurredAt, idempotencyKey: key }, signal)
    }}
    title="Новая заметка"
  />
}
