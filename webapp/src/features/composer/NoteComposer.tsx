import { useRef, useState } from 'react'
import { memoryDtoSchema, type ChildDto, type MemoryDto } from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'
import { createIdempotencyKey, createNoteMemory } from './api'
import { ComposerForm } from './ComposerForm'
import { ChildTagPicker } from '@/components/ui-v2/ChildTagPicker'
import { composerChildIds, sameChildIds } from '@/components/ui-v2/child-tags'
import { composerInitialDate } from './date'

export type NoteComposerProps = {
  childId: string
  /** The family's children; a picker appears when there are two or more. */
  childOptions?: ChildDto[]
  /** Preselected children (the child whose page the add started from). */
  initialChildIds?: string[]
  familyId: string
  familyTimezone: string
  transport: AuthenticatedTransport
  onCancel: () => void
  onSuccess: () => void | Promise<void>
  onPublished?: (memory: MemoryDto) => void
  onCancellationBlockedChange?: (blocked: boolean) => void
  onCancelRequestChange?: (cancel: () => void) => void
}

export function NoteComposer({ childId, childOptions, initialChildIds, familyId, familyTimezone, transport, onCancel, onSuccess, onPublished, onCancellationBlockedChange, onCancelRequestChange }: NoteComposerProps) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey())
  return <NoteComposerForm childId={childId} childOptions={childOptions} initialChildIds={initialChildIds} familyId={familyId} familyTimezone={familyTimezone} idempotencyKey={idempotencyKey} key={idempotencyKey} onAddAnother={() => setIdempotencyKey(createIdempotencyKey())} onCancel={onCancel} onSuccess={onSuccess} onPublished={onPublished} onCancellationBlockedChange={onCancellationBlockedChange} onCancelRequestChange={onCancelRequestChange} transport={transport} />
}

function NoteComposerForm({ childId, childOptions, initialChildIds = [], familyId, familyTimezone, idempotencyKey, onAddAnother, onCancel, onSuccess, onPublished, onCancellationBlockedChange, onCancelRequestChange, transport }: NoteComposerProps & { idempotencyKey: string; onAddAnother: () => void }) {
  const submission = useRef<{ body: string; occurredAt: string; childIds?: string[]; key: string } | null>(null)
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>(initialChildIds)
  return <ComposerForm
    addPresentation
    renderExtraFields={childOptions && childOptions.length >= 2 ? () => <ChildTagPicker childOptions={childOptions} onChange={setSelectedChildIds} selected={selectedChildIds} /> : undefined}
    extraFieldsDirty={!sameChildIds(selectedChildIds, initialChildIds)}
    description="Запишите важный момент для семейной ленты."
    familyTimezone={familyTimezone}
    initialBody=""
    initialDate={composerInitialDate(familyTimezone)}
    onCancel={onCancel}
    onAddAnother={onAddAnother}
    onSuccess={onSuccess}
    onCommitted={onPublished ? (result) => onPublished(memoryDtoSchema.parse(result)) : undefined}
    onCancellationBlockedChange={onCancellationBlockedChange}
    onCancelRequestChange={onCancelRequestChange}
    requireBody
    save={(body, occurredAt, signal) => {
      const previous = submission.current
      const childIds = composerChildIds(childOptions, selectedChildIds)
      // The server binds the key to the whole request, children included.
      const key = previous?.body === body && previous.occurredAt === occurredAt && sameChildIds(previous.childIds, childIds)
        ? previous.key
        : previous ? createIdempotencyKey() : idempotencyKey
      submission.current = { body, occurredAt, childIds, key }
      return createNoteMemory(transport, familyId, { childId, ...(childIds ? { childIds } : {}), body, occurredAt, idempotencyKey: key }, signal)
    }}
    title="Новая заметка"
  />
}
