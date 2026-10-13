import { useEffect, useRef, useState } from 'react'

import type { AuthContextValue } from '@/features/auth/context'

export function DiagnosticMaxApproval({ auth, challengeId, initData }: {
  auth: AuthContextValue
  challengeId: string
  initData: string
}) {
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  const displayCode = challengeId.slice(0, 6)

  useEffect(() => () => { generation.current += 1 }, [])

  const approve = async () => {
    if (inFlight.current) return
    inFlight.current = true
    const current = ++generation.current
    setBusy(true)
    setError(null)
    try {
      await auth.approveBrowserLink(challengeId, initData)
      if (generation.current === current) setApproved(true)
    } catch {
      if (generation.current === current) setError('Не удалось подтвердить вход. Код мог истечь. Создайте новый код в браузере.')
    } finally {
      inFlight.current = false
      if (generation.current === current) setBusy(false)
    }
  }

  return <main className="diagnostic-page">
    <h1>Подтвердите вход в браузере</h1>
    {approved ? <p role="status">Вход подтверждён. Вернитесь в открытую вкладку браузера.</p> : <>
      <p>Подтверждайте только если вы сами начали вход и код совпадает с кодом в браузере.</p>
      <p aria-label="Код подтверждения" className="diagnostic-state"><strong>{displayCode}</strong></p>
      {error ? <p className="diagnostic-error" role="alert">{error}</p> : null}
      <button className="diagnostic-login" disabled={busy} onClick={() => void approve()} type="button">{busy ? 'Подтверждаем…' : 'Подтвердить вход'}</button>
    </>}
  </main>
}
