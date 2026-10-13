import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserLinkStartResponse } from '@web-app-demo/contracts'

import type { AuthContextValue } from '@/features/auth/context'
import { createMaxBrowserLink } from '@/platform/max/host-bridge'

export function DiagnosticMaxLogin({ auth }: { auth: AuthContextValue }) {
  const [challenge, setChallenge] = useState<BrowserLinkStartResponse | null>(null)
  const [status, setStatus] = useState<'pending' | 'approved' | 'expired'>('pending')
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const startInFlight = useRef(false)
  const generation = useRef(0)

  const start = useCallback(async () => {
    if (startInFlight.current) return
    startInFlight.current = true
    const current = ++generation.current
    setIsStarting(true)
    setError(null)
    setChallenge(null)
    setStatus('pending')
    try {
      const next = await auth.startBrowserLink()
      if (generation.current === current) setChallenge(next)
    } catch {
      if (generation.current === current) setError('Не удалось создать запрос входа. Проверьте соединение и повторите.')
    } finally {
      if (generation.current === current) setIsStarting(false)
      startInFlight.current = false
    }
  }, [auth])

  useEffect(() => () => { generation.current += 1 }, [])

  useEffect(() => {
    if (!challenge) return
    let stopped = false
    let terminal = false
    let polling = false
    let timer: number | undefined

    const schedule = () => {
      if (!stopped && !terminal && document.visibilityState !== 'hidden') {
        timer = window.setTimeout(() => { void poll() }, 1500)
      }
    }
    const poll = async () => {
      if (stopped || terminal || polling || document.visibilityState === 'hidden') return
      polling = true
      try {
        const next = await auth.browserLinkStatus(challenge.challengeId)
        if (stopped) return
        setStatus(next.status)
        if (next.status === 'expired') {
          terminal = true
          return
        }
        if (next.status === 'approved') {
          setIsRedeeming(true)
          setError(null)
          try {
            await auth.redeemBrowserLink(challenge.challengeId)
            terminal = true
          } catch {
            if (!stopped) setError('Не удалось завершить вход. Создайте новый запрос и повторите.')
            terminal = true
          } finally {
            if (!stopped) setIsRedeeming(false)
          }
        } else {
          setError(null)
        }
      } catch {
        if (!stopped) setError('Не удалось проверить подтверждение. Проверьте соединение.')
      } finally {
        polling = false
        schedule()
      }
    }
    const resume = () => {
      if (document.visibilityState !== 'hidden') {
        if (timer !== undefined) window.clearTimeout(timer)
        void poll()
      }
    }

    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
    }
  }, [auth, challenge])

  const maxLink = challenge ? createMaxBrowserLink(challenge.startParam, import.meta.env.VITE_MAX_BOT_USERNAME) : null

  return <main className="diagnostic-page">
    <h1>Вход через MAX</h1>
    <p>Создайте код, откройте MAX и подтвердите вход. После подтверждения вернитесь в эту вкладку — лента откроется здесь.</p>
    {challenge ? <section aria-label="Подтверждение входа">
      <p>Код подтверждения</p>
      <p aria-label="Код подтверждения" className="diagnostic-state"><strong>{challenge.displayCode}</strong></p>
      {maxLink ? <p><a className="diagnostic-login" href={maxLink} rel="noreferrer" target="_blank">Открыть MAX</a></p> : <p className="diagnostic-error" role="alert">Ссылка на MAX не настроена.</p>}
      <p aria-live="polite" className="diagnostic-state" role="status">{isRedeeming ? 'Завершаем вход…' : status === 'approved' ? 'Подтверждено. Открываем ленту…' : status === 'expired' ? 'Запрос истёк.' : 'Ожидаем подтверждение в MAX…'}</p>
    </section> : null}
    {error ? <p className="diagnostic-error" role="alert">{error}</p> : null}
    {!challenge || status === 'expired' || error ? <button className="diagnostic-login" disabled={isStarting} onClick={() => void start()} type="button">{isStarting ? 'Создаём код…' : challenge ? 'Создать новый код' : 'Создать код для входа через MAX'}</button> : null}
    <ReportButton />
  </main>
}

function ReportButton() {
  const [copied, setCopied] = useState(false)
  const [fallback, setFallback] = useState('')
  const copy = useCallback(async () => {
    const report = window.__MEMOLY_DIAGNOSTICS__?.report() ?? '{"error":"report-unavailable"}'
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(report)
      setCopied(true)
      setFallback('')
    } catch { setFallback(report) }
  }, [])
  return <><button className="diagnostic-report" onClick={() => void copy()} type="button">{copied ? 'Отчёт скопирован' : 'Скопировать отчёт'}</button>{fallback ? <textarea aria-label="Отчёт для ручного копирования" className="diagnostic-fallback" readOnly value={fallback} /> : null}</>
}
