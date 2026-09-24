import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { familyCalendarDate } from '@/features/family'
import { ApiRequestError } from '@/platform/api'
import { composerOccurredAt } from './date'
import { AddDateField } from './AddDateField'
import '@/styles/composer-skin.css'

type ComposerFormProps = {
  addPresentation?: boolean
  title: string
  description: string
  initialBody: string
  initialDate: string
  familyTimezone: string
  save: (body: string, occurredAt: string, signal: AbortSignal) => Promise<unknown>
  requireBody?: boolean
  onConflict?: () => Promise<void>
  onCancel: () => void
  onAddAnother?: () => void
  onSuccess: () => void | Promise<void>
  conflictMessage?: boolean
}

export function ComposerForm({ title, description, initialBody, initialDate, familyTimezone, save, onCancel, onSuccess, requireBody = false, onConflict, conflictMessage = false, addPresentation = false, onAddAnother }: ComposerFormProps) {
  const [body, setBody] = useState(initialBody)
  const [occurredDate, setOccurredDate] = useState(initialDate)
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [networkError, setNetworkError] = useState(false)
  const submitting = useRef(false)
  const submission = useRef<{ body: string; date: string; occurredAt: string } | null>(null)

  async function submit() {
    if (submitting.current || status === 'success') return
    if (requireBody && !body.trim()) {
      setNetworkError(false)
      setError('Введите текст заметки.')
      setStatus('error')
      return
    }
    if ([...body].length > 8000) {
      setNetworkError(false)
      setError('Текст не может быть длиннее 8 000 символов.')
      setStatus('error')
      return
    }
    const trimmedBody = body.trim()
    const previous = submission.current
    const occurredAt = previous?.body === trimmedBody && previous.date === occurredDate
      ? previous.occurredAt
      : composerOccurredAt(occurredDate, familyTimezone)
    if (!occurredAt) {
      setNetworkError(false)
      setError('Дата воспоминания не может быть в будущем.')
      setStatus('error')
      return
    }
    submitting.current = true
    submission.current = { body: trimmedBody, date: occurredDate, occurredAt }
    setError(null)
    setNetworkError(false)
    setStatus('saving')
    const controller = new AbortController()
    try {
      await save(trimmedBody, occurredAt, controller.signal)
      setStatus('success')
      if (!addPresentation) try { await onSuccess() } catch { /* the memory is already durable */ }
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
      setNetworkError(true)
    } finally {
      submitting.current = false
    }
  }

  function cancel() {
    const dirty = body !== initialBody || occurredDate !== initialDate
    if (dirty && !window.confirm('Отменить изменения? Введённый текст и дата будут удалены.')) return
    onCancel()
  }

  if (addPresentation) return <main className="memoly-add-page" data-add-screen="note">
    {status === 'success' ? <section aria-label="Заметка сохранена" className="memoly-add-success" role="status">
      <Typography aria-hidden as="span" className="memoly-add-success-mark" variant="memoryScreen">✓</Typography>
      <Typography as="h1" variant="memoryScreen">Заметка сохранена!</Typography><Typography as="p" variant="memoryBody">Теперь она в ленте воспоминаний</Typography>
      <div className="memoly-add-success-actions"><Button onClick={() => void onSuccess()} type="button">Смотреть в ленте</Button><Button onClick={onAddAnother} type="button" variant="outline">Добавить ещё</Button></div>
    </section> : status === 'error' && networkError ? <section aria-label="Не удалось сохранить заметку" className="memoly-add-success memoly-add-failure" role="alert"><WebpIcon decorative name="warning" size={64} /><Typography as="h1" variant="memoryScreen">Не удалось сохранить заметку</Typography><Typography as="p" variant="memoryBody">{error}</Typography><div className="memoly-add-success-actions"><Button onClick={() => void submit()} type="button">Попробовать снова</Button><Button onClick={() => { setNetworkError(false); setStatus('idle'); setError(null) }} type="button" variant="outline">Вернуться к заметке</Button></div></section> : <>
      <header className="memoly-add-topbar"><button aria-label="Назад" className="memoly-add-back" disabled={status === 'saving'} onClick={cancel} type="button"><WebpIcon decorative name="chevron" size={20} /></button><Typography as="h1" variant="memoryScreen">Добавить заметку</Typography><span /></header>
      <div className="memoly-add-body">
        <div className="memoly-add-note-field"><textarea aria-label="Текст заметки" disabled={status === 'saving'} id="memory-composer-body" onChange={(event) => setBody(event.currentTarget.value)} placeholder="Напишите, что хотите сохранить…" value={body} /><Typography as="span" variant="memoryMeta">{[...body].length}/8000</Typography></div>
        <AddDateField id="memory-composer-date" label="Дата воспоминания" onChange={setOccurredDate} today={familyCalendarDate(familyTimezone)} value={occurredDate} />
        <Button className="memoly-add-publish" disabled={status === 'saving' || !body.trim() || [...body].length > 8000} onClick={() => void submit()} type="button">Опубликовать</Button>
        {status === 'saving' ? <div aria-live="polite" className="memoly-add-loading" role="status"><span className="memoly-composer-progress-indeterminate" /><Typography as="span" variant="memoryBody">Сохраняем заметку…</Typography></div> : null}
        {error ? <div className="memoly-add-error" role="alert"><WebpIcon decorative name="warning" size={28} /><Typography as="p" variant="memoryBody">{error}</Typography><Button onClick={() => void submit()} type="button">Попробовать снова</Button></div> : null}
      </div>
    </>}
  </main>

  return (
    <main className="memoly-composer-page mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)]">
      <section aria-labelledby="composer-form-title" className="memoly-composer-card rounded-[var(--radius-card)] p-5">
        <Typography id="composer-form-title" variant="memoryScreen">{title}</Typography>
        <Typography className="mt-2" tone="muted" variant="memoryBody">{description}</Typography>
        <label className="memoly-composer-label mt-6 block" htmlFor="memory-composer-body"><Typography variant="memoryButton">Текст</Typography></label>
        <textarea aria-label="Текст заметки" className="memoly-composer-field memoly-composer-textarea mt-2 w-full rounded-[var(--radius-field)] p-3" id="memory-composer-body" onChange={(event) => setBody(event.currentTarget.value)} value={body} />
        <label className="memoly-composer-label mt-5 block" htmlFor="memory-composer-date"><Typography variant="memoryButton">Дата</Typography></label>
        <input aria-label="Дата воспоминания" className="memoly-composer-field memoly-composer-date mt-2 w-full rounded-[var(--radius-field)] p-3" id="memory-composer-date" max={familyCalendarDate(familyTimezone)} onChange={(event) => setOccurredDate(event.currentTarget.value)} type="date" value={occurredDate} />
        {status === 'saving' ? <div className="memoly-composer-status mt-4" role="status"><Typography aria-live="polite" variant="memoryMeta">Сохраняем…</Typography><span className="memoly-composer-progress-indeterminate" /></div> : null}
        {status === 'success' ? <Typography aria-live="polite" className="memoly-composer-status mt-4" variant="memoryMeta">Сохранено в семейную ленту</Typography> : null}
        {error ? <Typography aria-live="assertive" className="mt-4 text-destructive" role="alert" variant="memoryMeta">{error}</Typography> : null}
        <div className="memoly-composer-actions mt-6 flex gap-3">
          <Button className="memoly-composer-primary min-h-12 flex-1" disabled={status === 'saving'} onClick={() => void submit()} type="button">Сохранить</Button>
          <Button className="memoly-composer-secondary min-h-12" disabled={status === 'saving'} onClick={() => {
            cancel()
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
