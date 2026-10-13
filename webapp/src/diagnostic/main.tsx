import { Component, StrictMode, useCallback, useEffect, useRef, useState, useLayoutEffect, type PropsWithChildren } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'

import { AuthProvider } from '@/features/auth/provider'
import { PrivateCacheGate } from '@/features/auth/private-cache-gate'
import { useAuth } from '@/features/auth/use-auth'
import { shouldKeepHostAuthPreloader, useHostAuthHandoff } from '@/features/auth/host-auth-handoff'
import { loadFamily, loadFamilyHome } from '@/features/family/api'
import { DiagnosticFeed } from './DiagnosticFeed'
import { ApiRequestError } from '@/platform/api'
import { createHostBridge, type HostBridge } from '@/platform/host-bridge'
import {
  allowPrivateFamilyCache,
  privateFamilyAccessRevokedEvent,
  removePrivateFamilyCache,
} from '@/platform/persistence/private-cache'
import type { FamilyHomeResponse } from '@web-app-demo/contracts'

import './diagnostic-feed.css'

declare global {
  interface Window {
    __MEMOLY_STARTUP__?: { hostReady?: Promise<boolean>; fail: () => void; canMount: () => boolean; mounted: () => void }
    __MEMOLY_DIAGNOSTICS__?: { record: (kind: string, phase?: string) => void; report: () => string; updateState?: (key: string, value: Record<string, unknown>) => void }
  }
}

const queryClient = new QueryClient()
const root = createRoot(document.getElementById('root')!)
async function mount() {
  if (window.__MEMOLY_STARTUP__?.hostReady && !(await window.__MEMOLY_STARTUP__.hostReady)) return
  if (window.__MEMOLY_STARTUP__ && !window.__MEMOLY_STARTUP__.canMount()) return
  const hostBridge = createHostBridge(window, { maxBotUsername: import.meta.env.VITE_MAX_BOT_USERNAME })
  hostBridge.ready()
  root.render(<StrictMode><StartupBoundary><QueryClientProvider client={queryClient}><AuthProvider><PrivateCacheGate fallback={<p className="diagnostic-state" role="status">Восстанавливаем вход…</p>}><DiagnosticApp hostBridge={hostBridge} /></PrivateCacheGate></AuthProvider></QueryClientProvider></StartupBoundary></StrictMode>)
}

void mount().catch(() => {
  console.error('[memoLy] startup_failed')
  window.__MEMOLY_STARTUP__?.fail()
})

function StartupBoundary({ children }: PropsWithChildren) {
  useLayoutEffect(() => window.__MEMOLY_STARTUP__?.mounted(), [])
  return <StartupErrorBoundary>{children}</StartupErrorBoundary>
}

class StartupErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() {
    window.__MEMOLY_DIAGNOSTICS__?.record('react-boundary', 'mounted')
    window.__MEMOLY_STARTUP__?.fail()
  }
  render() {
    return this.state.failed ? <main className="diagnostic-page" role="alert">Не удалось открыть эксперимент. <ReportButton /></main> : this.props.children
  }
}

function DiagnosticApp({ hostBridge }: { hostBridge: HostBridge }) {
  const auth = useAuth()
  const initData = hostBridge.rawAuthData()
  const provider = hostBridge.kind === 'max' || hostBridge.kind === 'telegram' ? hostBridge.kind : null
  const handoff = useHostAuthHandoff({ auth, provider, initData, isHostAvailable: hostBridge.isAvailable })
  const hostAuthState = provider ? {
    provider,
    hasStartedAuth: handoff.startedHostAuthKey === handoff.authAttemptKey,
    hasPreviousAuthAttempt: handoff.hasStartedHostAuth,
    hasInitData: Boolean(initData),
    isAuthenticated: auth.isAuthenticated,
    isAuthBootstrapping: auth.isBootstrapping,
    isAuthPending: handoff.isHostAuthPending,
    isHostAvailable: hostBridge.isAvailable,
  } : null

  if (auth.isBootstrapping || (hostAuthState && shouldKeepHostAuthPreloader(hostAuthState))) {
    return <main className="diagnostic-page"><p className="diagnostic-state" role="status">Восстанавливаем вход…</p></main>
  }
  if (auth.sessionError) return <main className="diagnostic-page" role="alert"><p>Не удалось восстановить вход. Проверьте соединение и обновите страницу.</p><ReportButton /></main>
  if (!auth.user || (hostBridge.kind === 'browser' && auth.externalIdentityProvider !== 'max')) {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`
    return <main className="diagnostic-page"><h1>Диагностическая лента</h1><p>Войдите через MAX в основном приложении, затем вернитесь по этому адресу:</p><a className="diagnostic-login" href={`/?returnTo=${encodeURIComponent(returnTo)}`}>Открыть основной экран входа</a><p>После завершения входа откройте адрес этого эксперимента снова в том же браузере.</p><ReportButton /></main>
  }
  return <FeedExperiment key={auth.user.id} hostBridge={hostBridge} userId={auth.user.id} displayName={auth.user.displayName ?? auth.user.id} transport={auth.transport} />
}

function FeedExperiment({ hostBridge, userId, displayName, transport }: { hostBridge: HostBridge; userId: string; displayName: string; transport: ReturnType<typeof useAuth>['transport'] }) {
  const [home, setHome] = useState<FamilyHomeResponse | null>(null)
  const [selected, setSelected] = useState<{ familyId: string; membershipEpoch: number; name: string } | null>(null)
  const [homeError, setHomeError] = useState('')
  const [selectionBusy, setSelectionBusy] = useState(false)
  const queryClient = useQueryClient()
  const mounted = useRef(true)
  const selectionGeneration = useRef(0)

  useEffect(() => {
    let cancelled = false
    mounted.current = true
    void (async () => {
      try {
        let page = await loadFamilyHome(transport)
        let items = [...page.items]
        while (page.nextCursor) {
          page = await loadFamilyHome(transport, page.nextCursor)
          items = [...items, ...page.items]
        }
        const next = { ...page, items }
        if (!cancelled) {
          setHome(next)
        }
      } catch {
        if (!cancelled) setHomeError('Не удалось загрузить список семей.')
      }
    })()
    return () => { cancelled = true; mounted.current = false; selectionGeneration.current += 1 }
  }, [queryClient, transport, userId])

  const selectFamily = useCallback(async (familyId: string, membershipEpoch: number, name: string) => {
    const generation = ++selectionGeneration.current
    setSelectionBusy(true)
    setSelected(null)
    try {
      await loadFamily(transport, familyId)
      if (!mounted.current || selectionGeneration.current !== generation) return
      allowPrivateFamilyCache(userId, familyId)
      setSelected({ familyId, membershipEpoch, name })
    } catch (error) {
      if (!mounted.current || selectionGeneration.current !== generation) return
      if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
        await removePrivateFamilyCache(queryClient, userId, familyId)
        setHome((current) => current ? { ...current, items: current.items.filter((item) => item.familyId !== familyId) } : current)
      }
      setHomeError(error instanceof ApiRequestError && [403, 404].includes(error.status) ? 'Доступ к этой семье закрыт.' : 'Не удалось открыть семью.')
    } finally { if (mounted.current && selectionGeneration.current === generation) setSelectionBusy(false) }
  }, [home, queryClient, transport, userId])

  useEffect(() => {
    const revoke = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; familyId?: string }>).detail
      if (detail?.userId !== userId || !detail.familyId) return
      void removePrivateFamilyCache(queryClient, userId, detail.familyId)
      setHome((current) => current ? { ...current, items: current.items.filter((item) => item.familyId !== detail.familyId) } : current)
      setSelected((current) => current?.familyId === detail.familyId ? null : current)
    }
    window.addEventListener(privateFamilyAccessRevokedEvent, revoke)
    return () => window.removeEventListener(privateFamilyAccessRevokedEvent, revoke)
  }, [queryClient, userId])

  return <div className="diagnostic-page">
    <header className="diagnostic-header"><h1>Диагностическая лента</h1><ReportButton /></header>
    <main className="diagnostic-main">
      <p>Вы вошли как {displayName}.</p>
      {home ? <section aria-label="Семьи" className="diagnostic-family-picker">
        <strong>Выберите семью</strong>
        {home.items.map((item) => <button aria-pressed={selected?.familyId === item.familyId} disabled={selectionBusy} key={item.familyId} onClick={() => void selectFamily(item.familyId, item.membershipEpoch, item.name)} type="button">{item.name} · {item.role === 'full' ? 'полный доступ' : 'просмотр'}</button>)}
        {home.items.length === 0 ? <p>Доступных семей пока нет.</p> : null}
      </section> : <p className="diagnostic-state" role="status">{homeError || 'Загружаем семьи…'}</p>}
      {homeError ? <p className="diagnostic-error" role="alert">{homeError}</p> : null}
      {selected ? <section aria-label={`Лента семьи ${selected.name}`}>
        <h2>{selected.name}</h2>
        <DiagnosticFeed familyId={selected.familyId} hostBridge={hostBridge} membershipEpoch={selected.membershipEpoch} userId={userId} transport={transport} onAccessRevoked={() => window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId, familyId: selected.familyId } }))} />
      </section> : null}
    </main>
  </div>
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
