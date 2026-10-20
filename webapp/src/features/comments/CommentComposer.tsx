import { useRef, useState } from 'react'
import type { CommentCreateAttempt } from './state'
import { createCommentAttempt } from './state'
import { Typography } from '@/components/typography'

export function CommentComposer({ onCreate, busy, uncertainAttempt, value, onChange }: {
  onCreate: (attempt: CommentCreateAttempt) => Promise<void>
  busy: boolean
  uncertainAttempt: CommentCreateAttempt | null
  value: string
  onChange: (value: string) => void
}) {
  const inFlight = useRef(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const submit = async () => {
    if (inFlight.current || busy) return
    inFlight.current = true
    try {
      setValidationError(null)
      await onCreate(uncertainAttempt ?? createCommentAttempt(value))
    } catch { setValidationError('Введите комментарий длиной от 1 до 2 000 символов.') }
    finally { inFlight.current = false }
  }
  return <form className="comments-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
    {validationError ? <Typography as="p" className="comments-status" role="alert" variant="bodyXs">{validationError}</Typography> : null}
    {uncertainAttempt ? <Typography as="p" className="comments-status" role="status" variant="bodyXs">Не удалось подтвердить отправку. Повтор использует ту же попытку и текст.</Typography> : null}
    <textarea aria-label="Написать комментарий" disabled={busy || Boolean(uncertainAttempt)} maxLength={4000} onChange={(event) => onChange(event.currentTarget.value)} placeholder="Написать комментарий…" value={uncertainAttempt?.body ?? value} />
    <button disabled={busy || (!uncertainAttempt && !value.trim())} type="submit"><Typography as="span" variant="memoryButton">{busy ? 'Отправка…' : uncertainAttempt ? 'Повторить отправку' : 'Отправить'}</Typography></button>
  </form>
}
