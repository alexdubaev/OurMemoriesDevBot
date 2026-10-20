import { useRef, useState } from 'react'
import type { CommentCreateAttempt } from './state'
import { createCommentAttempt } from './state'

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
    {validationError ? <p className="comments-status" role="alert">{validationError}</p> : null}
    {uncertainAttempt ? <p className="comments-status" role="status">Не удалось подтвердить отправку. Повтор использует ту же попытку и текст.</p> : null}
    <textarea aria-label="Написать комментарий" disabled={busy || Boolean(uncertainAttempt)} maxLength={4000} onChange={(event) => onChange(event.currentTarget.value)} placeholder="Написать комментарий…" value={uncertainAttempt?.body ?? value} />
    <button disabled={busy || (!uncertainAttempt && !value.trim())} type="submit">{busy ? 'Отправка…' : uncertainAttempt ? 'Повторить отправку' : 'Отправить'}</button>
  </form>
}
