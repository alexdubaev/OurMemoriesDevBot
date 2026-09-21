import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { familyCalendarDate } from '@/features/family'
import { ApiRequestError } from '@/platform/api'
import { composerOccurredAt } from './date'

type ComposerFormProps = {
  title: string
  description: string
  initialBody: string
  initialDate: string
  familyTimezone: string
  save: (body: string, occurredAt: string, signal: AbortSignal) => Promise<unknown>
  requireBody?: boolean
  onConflict?: () => Promise<void>
  onCancel: () => void
  onSuccess: () => void | Promise<void>
  conflictMessage?: boolean
}

export function ComposerForm({ title, description, initialBody, initialDate, familyTimezone, save, onCancel, onSuccess, requireBody = false, onConflict, conflictMessage = false }: ComposerFormProps) {
  const [body, setBody] = useState(initialBody)
  const [occurredDate, setOccurredDate] = useState(initialDate)
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (status === 'saving') return
    if (requireBody && !body.trim()) {
      setError('Введите текст заметки.')
      setStatus('error')
      return
    }
    const occurredAt = composerOccurredAt(occurredDate, familyTimezone)
    if (!occurredAt) {
      setError('Дата воспоминания не может быть в будущем.')
      setStatus('error')
      return
    }
    setError(null)
    setStatus('saving')
    const controller = new AbortController()
    try {
      await save(body.trim(), occurredAt, controller.signal)
      setStatus('success')
      try { await onSuccess() } catch { /* the memory is already durable */ }
    } catch (reason) {
      if (controller.signal.aborted) return
      if (conflictMessage && isConflict(reason)) {
        try {
          await onConflict?.()
          setError(onConflict
            ? 'Конфликт: это воспоминание уже изменили. Актуальная версия загружена; проверьте текст и дату и нажмите «Сохранить» ещё раз.'
            : 'Конфликт: это воспоминание уже изменили. Проверьте текст и дату и повторите попытку.')
        } catch {
          setError('Конфликт: не удалось получить актуальную версию. Проверьте соединение и повторите попытку.')
        }
      } else {
        setError('Не удалось сохранить воспоминание. Попробуйте ещё раз.')
      }
      setStatus('error')
    }
  }

  return (
    <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-4 py-6">
      <section aria-labelledby="composer-form-title" className="rounded-[var(--radius-card)] bg-card p-5 shadow-[var(--shadow-card)]">
        <Typography id="composer-form-title" variant="memoryScreen">{title}</Typography>
        <Typography className="mt-2" tone="muted" variant="memoryBody">{description}</Typography>
        <label className="mt-6 block" htmlFor="memory-composer-body"><Typography variant="memoryButton">Текст</Typography></label>
        <textarea aria-label="Текст заметки" className="mt-2 min-h-32 w-full rounded-[var(--radius-field)] border bg-muted p-3" id="memory-composer-body" onChange={(event) => setBody(event.currentTarget.value)} value={body} />
        <label className="mt-5 block" htmlFor="memory-composer-date"><Typography variant="memoryButton">Дата</Typography></label>
        <input aria-label="Дата воспоминания" className="mt-2 w-full rounded-[var(--radius-field)] border bg-muted p-3" id="memory-composer-date" max={familyCalendarDate(familyTimezone)} onChange={(event) => setOccurredDate(event.currentTarget.value)} type="date" value={occurredDate} />
        {status === 'saving' ? <Typography aria-live="polite" className="mt-4" variant="memoryMeta">Сохраняем…</Typography> : null}
        {status === 'success' ? <Typography aria-live="polite" className="mt-4" variant="memoryMeta">Сохранено в семейную ленту</Typography> : null}
        {error ? <Typography aria-live="assertive" className="mt-4 text-destructive" role="alert" variant="memoryMeta">{error}</Typography> : null}
        <div className="mt-6 flex gap-3">
          <Button className="min-h-12 flex-1" disabled={status === 'saving'} onClick={() => void submit()} type="button">Сохранить</Button>
          <Button className="min-h-12" disabled={status === 'saving'} onClick={() => {
            const dirty = body !== initialBody || occurredDate !== initialDate
            if (dirty && !window.confirm('Отменить изменения? Введённый текст и дата будут удалены.')) return
            onCancel()
          }} type="button" variant="outline">Отмена</Button>
        </div>
      </section>
    </main>
  )
}

function isConflict(reason: unknown) {
  return reason instanceof ApiRequestError
    ? reason.status === 409
    : Boolean(reason && typeof reason === 'object' && 'status' in reason && (reason as { status?: unknown }).status === 409)
}
