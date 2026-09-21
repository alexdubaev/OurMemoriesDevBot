import { useState } from 'react'
import type { MemoryDto } from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'
import { getMemory, updateMemory } from './api'
import { ComposerForm } from './ComposerForm'
import { memoryComposerInitialDate } from './date'

export type MemoryEditorProps = {
  memory: MemoryDto
  familyTimezone: string
  transport: AuthenticatedTransport
  onCancel: () => void
  onSuccess: () => void | Promise<void>
}

export function MemoryEditor({ memory, familyTimezone, transport, onCancel, onSuccess }: MemoryEditorProps) {
  const [expectedVersion, setExpectedVersion] = useState(memory.version)
  return <ComposerForm
    conflictMessage
    description="Измените текст или дату воспоминания."
    familyTimezone={familyTimezone}
    initialBody={memory.body}
    initialDate={memoryComposerInitialDate(memory, familyTimezone)}
    onCancel={onCancel}
    onConflict={async () => {
      const current = await getMemory(transport, memory.familyId, memory.id)
      setExpectedVersion(current.version)
    }}
    onSuccess={onSuccess}
    save={(body, occurredAt, signal) => updateMemory(transport, memory.familyId, memory.id, { body, occurredAt, expectedVersion }, signal)}
    title="Изменить воспоминание"
  />
}
