import { Typography } from '@/components/typography'
import { QueryCache, QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { createMaxBrowserLink } from '@/platform/max/host-bridge'
import { AuthApi, currentBrowserSessionEpoch, subscribeToBrowserSessionChanges } from '@/features/auth'
import { ApiRequestError } from '@/platform/api'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { WebpIcon, type WebpIconName } from '@/components/WebpIcon'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sidebar, SidebarProvider } from '@/components/ui/sidebar'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { controlApi, type FamilyMember, type FamilyRow, type Invite, type ListParams, type Membership, type MetricSample, type Overview, type Source, type Storage, type UserRow } from './control-api'

type Phase = 'starting' | 'signed-out' | 'checking' | 'allowed' | 'denied' | 'error'
type Section = 'overview' | 'families' | 'users' | 'storage' | 'sources' | 'system'
type SessionRuntime = { token: string | null; onAccessFailure: ((error: unknown) => void) | null; generation: number; checkController: AbortController | null }
const SECTIONS: { id: Section; label: string; icon: WebpIconName }[] = [
  { id: 'overview', label: 'Обзор', icon: 'home' }, { id: 'families', label: 'Семьи', icon: 'family' },
  { id: 'users', label: 'Пользователи', icon: 'user' }, { id: 'storage', label: 'Хранилище', icon: 'archive-box' },
  { id: 'sources', label: 'Подключения', icon: 'channel' }, { id: 'system', label: 'Состояние системы', icon: 'gear' },
]
const activeExports = new Set<AbortController>()

function createControlAuthApi(getRuntime: () => SessionRuntime, queryClient: QueryClient, epoch: string) {
  return new AuthApi({
    getAccessToken: () => getRuntime().token,
    setAccessToken: (token) => { getRuntime().token = token },
    onAuthExpired: () => { if (currentBrowserSessionEpoch() !== epoch) return; getRuntime().token = null; queryClient.clear(); getRuntime().onAccessFailure?.(new ApiRequestError(401, 'UNAUTHORIZED', 'Session expired')) },
  })
}

export function ControlApp({ onReady }: { onReady: () => void }) {
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache(),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: true, staleTime: 15_000 } },
  }))
  return <QueryClientProvider client={queryClient}><ControlSessionApp onReady={onReady} queryClient={queryClient} /></QueryClientProvider>
}

function ControlSessionApp({ onReady, queryClient }: { onReady: () => void; queryClient: QueryClient }) {
  const sessionRuntimeRef = useRef<SessionRuntime>({ token: null, onAccessFailure: null, generation: 0, checkController: null })
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error' && isAccessError(event.query.state.error)) sessionRuntimeRef.current.onAccessFailure?.(event.query.state.error)
  }), [queryClient])
  const [epoch, setEpoch] = useState(() => currentBrowserSessionEpoch())
  // The factory only captures this ref; it reads session data when AuthApi invokes its callbacks.
  // eslint-disable-next-line react-hooks/refs
  const api = useMemo(() => createControlAuthApi(() => sessionRuntimeRef.current, queryClient, epoch), [epoch, queryClient])
  const client = useMemo(() => controlApi(api), [api])
  const [phase, setPhase] = useState<Phase>('starting')
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const authorizeRef = useRef<(currentApi: AuthApi, signal?: AbortSignal) => Promise<void>>(async () => undefined)
  const [notice, setNotice] = useState('')
  const [isVisible, setIsVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const visibleRef = useRef(typeof document === 'undefined' || document.visibilityState === 'visible')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('memoly-control-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
  })
  const [section, setSection] = useState<Section>(() => sectionFromHash())
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const cancelPrivate = useCallback(() => {
    sessionRuntimeRef.current.generation += 1
    sessionRuntimeRef.current.checkController?.abort()
    sessionRuntimeRef.current.checkController = null
    for (const controller of activeExports) controller.abort()
    activeExports.clear()
    void queryClient.cancelQueries()
    queryClient.clear()
    setSelectedFamily(null); setSelectedUser(null); setCommandOpen(false); setCommandQuery('')
  }, [queryClient])
  const accessFailure = useCallback((error: unknown) => {
    cancelPrivate()
    if (error instanceof ApiRequestError && error.status === 403) setPhase('denied')
    else { sessionRuntimeRef.current.token = null; setPhase('signed-out') }
  }, [cancelPrivate])
  useEffect(() => { sessionRuntimeRef.current.onAccessFailure = accessFailure }, [accessFailure])

  const authorize = useCallback(async (currentApi = api, signal?: AbortSignal) => {
    if (!sessionRuntimeRef.current.token) { setPhase('signed-out'); return }
    cancelPrivate()
    const generation = sessionRuntimeRef.current.generation
    const controller = new AbortController()
    sessionRuntimeRef.current.checkController = controller
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
    setPhase('checking')
    try {
      await client.me(controller.signal)
      if (generation === sessionRuntimeRef.current.generation && !controller.signal.aborted && visibleRef.current && document.visibilityState === 'visible' && currentApi.isSessionEpochCurrent(epoch)) {
        setPhase('allowed')
      }
    } catch (error) {
      if (controller.signal.aborted || generation !== sessionRuntimeRef.current.generation) return
      if (isAccessError(error)) accessFailure(error)
      else setPhase('error')
    }
  }, [api, accessFailure, cancelPrivate, client, epoch])
  useEffect(() => { authorizeRef.current = authorize }, [authorize])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const generation = sessionRuntimeRef.current.generation
    api.refresh(epoch, { timeoutMs: 15_000 }).then((session) => {
      if (!active || generation !== sessionRuntimeRef.current.generation) return
      sessionRuntimeRef.current.token = session.accessToken
      return authorizeRef.current(api, controller.signal)
    }).catch((error: unknown) => {
      if (!active || generation !== sessionRuntimeRef.current.generation) return
      cancelPrivate()
      if (isAccessError(error)) { sessionRuntimeRef.current.token = null; setPhase('signed-out') }
      else setPhase('error')
    }).finally(() => { if (active) onReady() })
    return () => { active = false; controller.abort() }
  }, [api, epoch, cancelPrivate, onReady, bootstrapAttempt])

  useEffect(() => subscribeToBrowserSessionChanges((event) => {
    cancelPrivate(); sessionRuntimeRef.current.token = null; setPhase(event.state === 'authenticated' ? 'checking' : 'signed-out'); setEpoch(event.epoch)
  }), [cancelPrivate])

  const revalidate = useCallback(() => {
    const nextEpoch = currentBrowserSessionEpoch()
    if (nextEpoch !== epoch) { cancelPrivate(); sessionRuntimeRef.current.token = null; setPhase('checking'); setEpoch(nextEpoch); return }
    void authorize(api)
  }, [api, authorize, cancelPrivate, epoch])

  useEffect(() => {
    const onPageHide = () => { visibleRef.current = false; setIsVisible(false); if (phase === 'allowed' || (phase === 'checking' && sessionRuntimeRef.current.token)) flushSync(() => { cancelPrivate(); if (phase === 'allowed') setPhase('checking') }) }
    const onPageShow = (event: PageTransitionEvent) => { const visible = document.visibilityState === 'visible'; visibleRef.current = visible; setIsVisible(visible); if (visible && (event.persisted || visible)) revalidate() }
    const onVisibility = () => { const visible = document.visibilityState === 'visible'; visibleRef.current = visible; setIsVisible(visible); if (visible) { if (phase === 'allowed' || (phase === 'checking' && sessionRuntimeRef.current.token)) revalidate() } else if (phase === 'allowed' || (phase === 'checking' && sessionRuntimeRef.current.token)) flushSync(() => { cancelPrivate(); if (phase === 'allowed') setPhase('checking') }) }
    const onOnline = () => { if (document.visibilityState === 'visible') revalidate() }
    const onHash = () => setSection(sectionFromHash())
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true) } if (event.key === 'Escape') { setCommandOpen(false); setCommandQuery('') } }
    window.addEventListener('pagehide', onPageHide); window.addEventListener('pageshow', onPageShow); window.addEventListener('hashchange', onHash); window.addEventListener('online', onOnline); window.addEventListener('keydown', onKey); document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow); window.removeEventListener('hashchange', onHash); window.removeEventListener('online', onOnline); window.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility) }
  }, [cancelPrivate, phase, revalidate])

  const changeTheme = (value: 'light' | 'dark') => { setTheme(value); try { localStorage.setItem('memoly-control-theme', value) } catch { /* Preference is optional. */ } }
  const onLogout = async () => { cancelPrivate(); setPhase('signed-out'); sessionRuntimeRef.current.token = null; try { await api.logout() } catch { /* Local privacy state is already cleared. */ } finally { setEpoch(currentBrowserSessionEpoch()) } }
  const onRedeem = async (challenge: string) => {
    try { const data = await api.redeemBrowserLink(challenge); sessionRuntimeRef.current.token = data.accessToken; setEpoch(currentBrowserSessionEpoch()); setPhase('checking') }
    catch { setPhase('error') }
  }
  useEffect(() => { const onExportError = () => setNotice('Не удалось скачать файл. Проверьте фильтры и повторите позже.'); const onAccessError = (event: Event) => { accessFailure((event as CustomEvent).detail) }; window.addEventListener('control-export-error', onExportError); window.addEventListener('control-access-error', onAccessError); return () => { window.removeEventListener('control-export-error', onExportError); window.removeEventListener('control-access-error', onAccessError) } }, [accessFailure])
  const setSectionSafe = (next: Section) => { location.hash = `/${next}`; setSection(next); setMobileNavOpen(false); setSelectedFamily(null); setSelectedUser(null) }
  const activeLabel = SECTIONS.find((item) => item.id === section)?.label ?? 'Обзор'

  if (phase === 'starting' || phase === 'checking') return <div className="memoly-control-root" data-theme={theme}><div className="control-boot"><span className="control-wordmark"><Typography as="span" variant="bodySm">memoLy</Typography></span><Skeleton className="h-8 w-56" /><Typography as="p" variant="bodySm">{phase === 'starting' ? 'Проверяем защищённую сессию…' : 'Проверяем доступ к панели…'}</Typography></div></div>
  if (phase === 'signed-out') return <div className="memoly-control-root" data-theme={theme}><SignIn api={api} onRedeem={onRedeem} retry={() => { setPhase('starting'); setBootstrapAttempt((value) => value + 1) }} /></div>
  if (phase === 'denied') return <div className="memoly-control-root" data-theme={theme}><AccessClosed retry={revalidate} logout={onLogout} /></div>
  if (phase === 'error') return <div className="memoly-control-root" data-theme={theme}><div className="control-boot"><span className="control-wordmark"><Typography as="span" variant="bodySm">memoLy</Typography></span><Typography as="h1" variant="h3">Не удалось проверить доступ</Typography><Typography as="p" variant="bodySm">Данные панели скрыты. Проверьте соединение и повторите попытку.</Typography><Button onClick={() => { if (sessionRuntimeRef.current.token) revalidate(); else { setPhase('starting'); setBootstrapAttempt((attempt) => attempt + 1) } }}>Повторить</Button></div></div>

  return <div className="memoly-control-root" data-theme={theme} ref={setRootElement}>
    <SidebarProvider className="control-app-shell">
      <Sidebar collapsible="none" className="control-sidebar"><Brand /><Nav section={section} onSelect={setSectionSafe} /><div className="control-sidebar-bottom"><Typography as="p" variant="bodySm">Панель владельца</Typography><button className="control-theme-toggle" onClick={() => changeTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Переключить тему"><Typography as="span" variant="control">{theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}</Typography></button></div></Sidebar>
      <div className="control-main-column">
        <header className="control-topbar"><Button variant="outline" className="control-mobile-menu" onClick={() => setMobileNavOpen(true)}>Разделы</Button><Breadcrumb><BreadcrumbList><BreadcrumbItem><span><Typography as="span" variant="bodySm">memoLy</Typography></span></BreadcrumbItem><BreadcrumbSeparator>/</BreadcrumbSeparator><BreadcrumbItem><BreadcrumbPage>{activeLabel}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb><div className="control-top-actions"><button className="control-command-trigger" onClick={() => setCommandOpen(true)} aria-label="Поиск по панели"><Typography as="span" variant="control">Поиск </Typography><Typography as="kbd" variant="kbd">⌘ K</Typography></button><Button variant="outline" className="control-refresh" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["control"] }) }}>Обновить</Button><Button variant="outline" className="control-top-theme" onClick={() => changeTheme(theme === "light" ? "dark" : "light")} aria-label="Переключить тему">Тема</Button><Button variant="outline" onClick={onLogout}>Выйти</Button></div></header>
        <main className="control-page" aria-label={activeLabel}>
          {notice && <div className="control-notice" role="status"><Typography as="span" variant="bodySm">{notice}</Typography><button onClick={() => setNotice('')}><Typography as="span" variant="control">Закрыть</Typography></button></div>}
          {section === 'overview' && <OverviewPage api={client} enabled={isVisible} onFamily={setSelectedFamily} onSection={setSectionSafe} />}
          {section === 'families' && <FamiliesPage api={client} enabled={isVisible} onFamily={setSelectedFamily} />}
          {section === 'users' && <UsersPage api={client} enabled={isVisible} onUser={setSelectedUser} />}
          {section === 'storage' && <StoragePage api={client} enabled={isVisible} />}
          {section === 'sources' && <SourcesPage api={client} enabled={isVisible} />}
          {section === 'system' && <SystemPage api={client} enabled={isVisible} />}
        </main>
      </div>
    </SidebarProvider>
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}><SheetContent className="control-nav-sheet" side="left" showCloseButton={false} portalContainer={rootElement}><SheetHeader><div className="control-sheet-heading"><SheetTitle>Разделы панели</SheetTitle><Button variant="outline" onClick={() => setMobileNavOpen(false)}>Закрыть</Button></div><SheetDescription>Навигация по memoLy Control</SheetDescription></SheetHeader><Nav section={section} onSelect={setSectionSafe} /></SheetContent></Sheet>
    <FamilyDetail api={client} familyId={selectedFamily} onClose={() => setSelectedFamily(null)} onUser={(id) => setSelectedUser(id)} portalContainer={rootElement} enabled={isVisible} />
    <UserDetail api={client} userId={selectedUser} onClose={() => setSelectedUser(null)} portalContainer={rootElement} enabled={isVisible} />
    <CommandPalette api={client} open={commandOpen} query={commandQuery} setQuery={setCommandQuery} onClose={() => { setCommandOpen(false); setCommandQuery('') }} onFamily={(id) => { setCommandOpen(false); setCommandQuery(''); setSelectedFamily(id) }} onUser={(id) => { setCommandOpen(false); setCommandQuery(''); setSelectedUser(id) }} portalContainer={rootElement} enabled={isVisible} />
  </div>
}

function SignIn({ api, onRedeem, retry }: { api: AuthApi; onRedeem: (id: string) => void; retry: () => void }) {
  const [challenge, setChallenge] = useState<{ id: string; code: string; url: string; expires: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const begin = async () => {
    setBusy(true); setMessage('')
    try {
      const result = await api.startBrowserLink()
      const url = createMaxBrowserLink(result.startParam, import.meta.env.VITE_MAX_BOT_USERNAME)
      if (!url) { setMessage('Ссылка MAX временно недоступна. Повторите попытку позже.'); return }
      setChallenge({ id: result.challengeId, code: result.displayCode, url, expires: result.expiresAt })
    } catch { setMessage('Не удалось начать вход через MAX. Проверьте соединение и повторите попытку.') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!challenge) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return
      try {
        const status = await api.browserLinkStatus(challenge.id)
        if (!active) return
        if (status.status === 'approved') { onRedeem(challenge.id); setChallenge(null); return }
        if (status.status === 'expired' || Date.now() >= Date.parse(status.expiresAt)) { setChallenge(null); setMessage('Срок подтверждения истёк. Начните вход ещё раз.'); return }
      } catch { if (active) setMessage('Не удалось проверить подтверждение MAX. Повторите попытку.') }
      if (active) timer = setTimeout(poll, 1800)
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') void poll(); else clearTimeout(timer) }
    document.addEventListener('visibilitychange', onVisibility)
    void poll()
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [api, challenge, onRedeem])
  return <main className="control-login-shell"><section className="control-login-card"><Brand /><div><Typography as="p" variant="bodySm" className="control-eyebrow">ЗАКРЫТЫЙ ДОСТУП</Typography><Typography as="h1" variant="h3">Войдите через MAX</Typography><Typography as="p" variant="bodySm">Вход подтверждается в вашем аккаунте MAX. Пароль для панели не используется.</Typography></div>{challenge ? <div className="control-challenge"><Typography as="p" variant="bodySm">Откройте MAX и подтвердите вход</Typography><a className="control-primary-link" href={challenge.url} target="_blank" rel="noreferrer"><Typography as="span" variant="bodySm">Открыть MAX</Typography></a><div><span><Typography as="span" variant="bodySm">Код подтверждения</Typography></span><Typography as="strong" variant="emphasis">{challenge.code}</Typography></div><Typography as="small" variant="caption">Действителен до {new Date(challenge.expires).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</Typography><button onClick={() => setChallenge(null)}><Typography as="span" variant="control">Отменить</Typography></button></div> : <Button disabled={busy} onClick={begin}>{busy ? 'Подключаемся…' : 'Начать вход'}</Button>}{message && <Typography as="p" variant="bodySm" className="control-inline-error" role="alert">{message}</Typography>}<button className="control-link-button" onClick={retry}><Typography as="span" variant="control">Проверить существующую сессию</Typography></button></section></main>
}

function AccessClosed({ retry, logout }: { retry: () => void; logout: () => void }) { return <main className="control-login-shell"><section className="control-login-card"><Brand /><div><Typography as="p" variant="bodySm" className="control-eyebrow">ДОСТУП ЗАКРЫТ</Typography><Typography as="h1" variant="h3">У этой учётной записи нет доступа</Typography><Typography as="p" variant="bodySm">Данные панели удалены с экрана. Если доступ должен быть, подтвердите свою учётную запись MAX и попробуйте снова.</Typography></div><Button onClick={retry}>Повторить проверку</Button><Button variant="outline" onClick={logout}>Выйти</Button></section></main> }

function Brand() { return <div className="control-brand"><span className="control-brand-mark"><Typography as="span" variant="bodySm">m</Typography></span><span><Typography as="strong" variant="emphasis">memoLy</Typography><Typography as="small" variant="caption">КОНТРОЛЬ</Typography></span></div> }
function Nav({ section, onSelect }: { section: Section; onSelect: (id: Section) => void }) { return <nav className="control-nav" aria-label="Разделы">{SECTIONS.map((item) => <button key={item.id} onClick={() => onSelect(item.id)} aria-current={section === item.id ? 'page' : undefined} className={section === item.id ? 'is-active' : ''}><WebpIcon decorative monochrome name={item.icon} size={19} /><span><Typography as="span" variant="bodySm">{item.label}</Typography></span></button>)}</nav> }

function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="control-page-heading"><div><Typography as="p" variant="bodySm" className="control-eyebrow">MEMOLY / CONTROL</Typography><Typography as="h1" variant="h3">{title}</Typography><Typography as="p" variant="bodySm">{description}</Typography></div><Typography as="span" variant="bodySm">{action}</Typography></div> }
function useSectionQuery<T>(key: readonly unknown[], queryFn: ({ signal }: { signal: AbortSignal }) => Promise<T>, enabled: boolean) { return useQuery({ queryKey: key, queryFn, enabled, refetchInterval: enabled && document.visibilityState === 'visible' && navigator.onLine ? 60_000 : false, refetchIntervalInBackground: false }) }
function QueryState({ loading, error, retry, children }: { loading: boolean; error: unknown; retry: () => void; children: ReactNode }) { if (loading) return <div className="control-skeleton-grid" aria-label="Загрузка данных"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>; if (error) return <Empty className="control-empty"><EmptyHeader><EmptyTitle>Не удалось получить данные</EmptyTitle><EmptyDescription>Панель не показывает сохранённые данные из кэша.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={retry}>Повторить</Button></EmptyContent></Empty>; return <>{children}</> }
function statusLabel(status: string) { const words: Record<string, string> = { ok: 'В норме', stale: 'Устарело', error: 'Ошибка', not_configured: 'Не настроен', unsupported: 'Не поддерживается', insufficient_history: 'Недостаточно истории', active: 'Активна', deleting: 'Удаляется', deleted: 'Удалена', trashed: 'Корзина', purging: 'Очистка', purged: 'Очищена', inactive: 'Неактивна', configured: 'Подключён', disconnected: 'Отключён', unconfigured: 'Не настроен', pending: 'Ожидает', accepted: 'Принято', expired: 'Истекло', revoked: 'Отозвано', valid: 'Подтверждён', invalid: 'Не прошёл проверку', unknown: 'Неизвестно', available: 'Доступен', unavailable: 'Недоступен', ready: 'Готов', disabled: 'Отключён', running: 'Работает', idle: 'Ожидает', product_db: 'База продукта', postgres_size: 'Размер PostgreSQL', media_storage: 'Хранилище медиа', backup_storage: 'Резервные копии', host_filesystem: 'Файловая система хоста', service_probes: 'Проверки сервисов', max_binding_state: 'Состояние MAX', release_evidence: 'Сведения о выпуске' }; return words[status] ?? 'Неизвестное состояние' }
function capacityKindLabel(kind: string) { return ({ physical: 'Физический ресурс', configured_budget: 'Настроенный лимит', unknown: 'Неизвестна' } as Record<string, string>)[kind] ?? 'Неизвестна' }
function accountingBasisLabel(value: unknown) { const labels: Record<string,string> = { 'statvfs для разрешённого пути': 'Проверка свободного места файловой системы', 'Ограниченный обход хоста: размеры файлов без выделенных блоков диска': 'Подсчёт логических размеров файлов', 'Ограниченный обход регулярных файлов; отдельно от statvfs файловой системы': 'Подсчёт файлов резервных копий отдельно от диска', 'pg_database_size(current_database()); входит в диск хоста, если размещена там же': 'Размер базы PostgreSQL; может учитываться на диске хоста' }; return labels[String(value)] ?? String(value ?? 'Основа учёта не указана') }
function resourceLabel(value: unknown) { const labels: Record<string,string> = { 'family-quota-total':'Суммарный учёт квоты семей', 'postgres-database':'База данных PostgreSQL', host_filesystem:'Файловая система хоста', media_storage:'Логические объекты медиа', backup_storage:'Файлы резервных копий' }; const key = String(value ?? ''); return labels[key] ?? (key ? 'Ресурс инфраструктуры' : 'Нет / не указан') }
function StatusBadge({ status }: { status: string }) { const tone = ['ok','active','configured','valid','accepted','available','ready','running'].includes(status) ? 'good' : ['stale','pending','insufficient_history','idle','trashed','inactive'].includes(status) ? 'warn' : ['error','disconnected','deleting','deleted','purging','purged','invalid','unavailable','disabled'].includes(status) ? 'bad' : 'quiet'; return <Badge className={`control-badge ${tone}`}>{statusLabel(status)}</Badge> }
function sampleStatus(sample: MetricSample<unknown>) { return sample.status }
function sourceTime(sample: { observedAt: string | null; lastAttemptAt?: string | null }) { const value = sample.observedAt ?? sample.lastAttemptAt; return value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Нет измерений' }
function formatCount(value: number | null | undefined) { return value === null || value === undefined ? '—' : new Intl.NumberFormat('ru-RU').format(value) }
function formatBytes(value: string | null | undefined) { if (!value) return value === '0' ? '0 Б' : '—'; let amount = Number(value); if (!Number.isFinite(amount)) return value; const units = ['Б','КиБ','МиБ','ГиБ','ТиБ']; let unit = 0; while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++ } return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: unit ? 1 : 0 }).format(amount)} ${units[unit]}` }
function fmtDate(value: string | null) { return value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' }
function usePageCursor(params: Omit<ListParams, 'cursor' | 'limit'>) { const signature = JSON.stringify(params); const [state, setState] = useState<{ signature: string; cursors: (string | undefined)[]; index: number }>({ signature, cursors: [undefined], index: 0 }); const current = state.signature === signature ? state : { signature, cursors: [undefined], index: 0 }; const cursor = current.cursors[current.index]; const next = (value: string | null) => { if (!value) return; setState({ signature, cursors: [...current.cursors.slice(0, current.index + 1), value], index: current.index + 1 }) }; const previous = () => setState((value) => { const base = value.signature === signature ? value : current; return { ...base, index: Math.max(0, base.index - 1) } }); return { cursor, next, previous, canPrevious: current.index > 0, resetKey: signature } }
function TableToolbar({ search, setSearch, placeholder, children }: { search: string; setSearch: (value: string) => void; placeholder: string; children?: ReactNode }) { return <div className="control-toolbar"><label className="control-search"><span className="sr-only"><Typography as="span" variant="bodySm">Поиск</Typography></span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={placeholder} /></label>{children}</div> }
function Pagination({ previous, next, canPrevious, hasNext }: { previous: () => void; next: () => void; canPrevious: boolean; hasNext: boolean }) { return <div className="control-pagination"><span><Typography as="span" variant="bodySm">Показаны записи этой страницы</Typography></span><div><Button variant="outline" size="sm" disabled={!canPrevious} onClick={previous}>Назад</Button><Button variant="outline" size="sm" disabled={!hasNext} onClick={next}>Далее</Button></div></div> }

function OverviewPage({ api, enabled, onFamily, onSection }: { api: ReturnType<typeof controlApi>; enabled: boolean; onFamily: (id: string) => void; onSection: (section: Section) => void }) {
  const [days, setDays] = useState(7)
  const q = useSectionQuery(['control','overview',days], ({ signal }) => api.overview(days, signal), enabled)
  const events = useSectionQuery(['control','events','overview'], ({ signal }) => api.events({ limit: 6 }, signal), enabled)
  const latest = useSectionQuery(['control','overview','latest-families'], ({ signal }) => api.families({ limit: 5, sort: 'lastObservedAt' }, signal), enabled)
  const storage = useSectionQuery(['control','overview','storage-summary'], ({ signal }) => api.storage(signal), enabled)
  const sources = useSectionQuery(['control','overview','sources-summary'], ({ signal }) => api.sources(signal), enabled)
  return <><PageHeading title="Обзор" description="Текущее состояние продукта по проверенным источникам." /><QueryState loading={q.isLoading} error={q.error} retry={() => void q.refetch()}>{q.data && <>
    <div className="control-kpi-grid"><MetricCard title="Учётные записи" value={formatCount(q.data.accountsTotal)} hint={`${formatCount(q.data.accountsWithFamily)} с активной семьёй`} /><MetricCard title="Активные семьи" value={formatCount(q.data.familiesActive)} hint="Семейные пространства" /><div className="control-kpi-select"><label><Typography as="span" variant="label">Наблюдавшиеся аккаунты</Typography></label><ControlSelect value={String(days)} onChange={(value) => setDays(Number(value))} options={[["7","7 дней"],["30","30 дней"],["90","90 дней"]]} ariaLabel="Период активности" /><Typography as="strong" variant="emphasis">{formatCount(q.data.activeUsers.value)}</Typography><span><Typography as="span" variant="bodySm">Наблюдаемая активность</Typography></span><StatusBadge status={sampleStatus(q.data.activeUsers)} /><Typography as="small" variant="caption">Измерено: {sourceTime(q.data.activeUsers)}</Typography></div><MetricCard title="Учтено у семей" value={formatBytes(q.data.familyStorageUsedBytes)} hint="Счётчики квоты, данные БД" /></div>
    <div className="control-overview-secondary"><MetricCard title="Активные аккаунты" value={formatCount(q.data.accountsActive)} hint="Обычный доступ к сервису" /><MetricCard title="В корзине" value={formatCount(q.data.accountsTrashed)} hint="Архив доступен до срока очистки" /><MetricCard title="Очистка аккаунта" value={formatCount(q.data.accountsPurging)} hint="Физическая очистка продолжается" /><MetricCard title="Активные без семьи" value={formatCount(q.data.accountsWithoutFamily)} hint="Активные учётные записи" /><MetricCard title="Активные членства" value={formatCount(q.data.activeMemberships)} hint="Связи пользователей и семей" /><MetricCard title="Ожидающие приглашения" value={formatCount(q.data.invitePending)} hint="Не приняты и не истекли" /><MetricCard title="Действительные сессии" value={formatCount(q.data.validSessions)} hint="Сессия не означает, что человек онлайн" /></div>
    <div className="control-two-columns"><Card><CardHeader><CardTitle>Регистрации и наблюдаемая активность</CardTitle><CardDescription>Регистрации за период; активность без обезличенных очищенных аккаунтов, UTC.</CardDescription></CardHeader><CardContent><div className="control-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={mergeSeries(q.data)} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--control-border)" /><XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip labelFormatter={(value) => `${value} UTC`} /><Area type="monotone" dataKey="registrations" name="Регистрации" stroke="#475569" fill="#94a3b8" fillOpacity={0.18} connectNulls={false} /><Area type="monotone" dataKey="activity" name="Наблюдаемая активность" stroke="#2563eb" fill="#60a5fa" fillOpacity={0.16} connectNulls={false} /></AreaChart></ResponsiveContainer></div><details className="control-chart-table"><summary><Typography as="span" variant="bodySm">Открыть таблицу значений</Typography></summary><Table><TableHeader><TableRow><TableHead>Дата UTC</TableHead><TableHead>Регистрации</TableHead><TableHead>Активность</TableHead></TableRow></TableHeader><TableBody>{mergeSeries(q.data).map((row) => <TableRow key={row.day}><TableCell>{row.day}</TableCell><TableCell>{row.registrations}</TableCell><TableCell>{row.activity === null ? 'История ещё не собиралась' : row.activity}</TableCell></TableRow>)}</TableBody></Table></details><Typography as="p" variant="bodySm" className="control-footnote">Активность учитывается с момента включения сбора; пропуски до этого момента не заполняются предположениями.</Typography></CardContent></Card><div className="control-overview-summaries"><Card><CardHeader><CardTitle>Недавно наблюдавшиеся семьи</CardTitle><CardDescription>По последнему реальному сигналу активности.</CardDescription></CardHeader><CardContent>{latest.isLoading ? <Skeleton className="h-24" /> : latest.data?.items.length ? latest.data.items.map((family) => <button className="control-summary-row" key={family.id} onClick={() => onFamily(family.id)}><span><Typography as="strong" variant="emphasis">{family.name ?? 'Без названия'}</Typography><Typography as="small" variant="caption">{family.lastObservedAt ? fmtDate(family.lastObservedAt) : 'Нет наблюдений'}</Typography></span><span><Typography as="span" variant="bodySm">{formatCount(family.activeMembers)} уч.</Typography></span></button>) : <Typography as="p" variant="bodySm" className="control-muted">{latest.error ? 'Список семей недоступен.' : 'Нет семей для показа.'}</Typography>}</CardContent></Card><SourcesStorageSummary storage={storage.data} sources={sources.data} loading={storage.isLoading} /><Card><CardHeader><CardTitle>Последние события</CardTitle><CardDescription>События без содержимого воспоминаний.</CardDescription></CardHeader><CardContent>{events.isLoading ? <Skeleton className="h-28" /> : events.data?.items.length ? <div className="control-event-list">{events.data.items.map((event) => <div key={event.id}><span className="control-event-dot" /><div><Typography as="strong" variant="emphasis">{eventTitle(event.type)}</Typography><Typography as="p" variant="bodySm">{event.familyName ?? 'Событие системы'}</Typography><Typography as="small" variant="caption">{new Date(event.occurredAt).toLocaleString('ru-RU')}</Typography></div>{event.familyId && <Button size="sm" variant="ghost" onClick={() => onFamily(event.familyId!)}>Открыть</Button>}</div>)}</div> : <Typography as="p" variant="bodySm" className="control-muted">{events.error ? 'Не удалось загрузить события.' : 'Подтверждённых событий пока нет.'}</Typography>}<Button variant="link" onClick={() => onSection('families')}>Перейти к семьям</Button></CardContent></Card></div></div>
  </>}</QueryState></>
}
function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) { return <Card className="control-metric-card"><CardHeader><CardDescription>{title}</CardDescription><CardTitle>{value}</CardTitle></CardHeader><CardContent><Typography as="p" variant="bodySm">{hint}</Typography></CardContent></Card> }
function SourcesStorageSummary({ storage, sources, loading }: { storage?: Storage; sources?: Source[]; loading: boolean }) {
  if (!storage && loading) return <Card><CardHeader><CardTitle>Источники и хранилище</CardTitle></CardHeader><CardContent><Skeleton className="h-24" /></CardContent></Card>
  return <Card><CardHeader><CardTitle>Источники и хранилище</CardTitle><CardDescription>Отдельные ресурсы и состояния источников.</CardDescription></CardHeader><CardContent><div className="control-summary-stack">
    {storage ? <>
      <SummaryMetric title="Файловая система · свободно" sample={storage.hostFilesystem} value={formatBytes(storage.hostFilesystem.value?.availableBytes)} />
      <SummaryMetric title="Медиа · учтено" sample={storage.mediaStorage} value={formatBytes(storage.mediaStorage.value?.usedBytes)} />
      <SummaryMetric title="Семейная квота · использовано" sample={storage.familyAccounting} value={formatBytes(storage.familyAccounting.value?.usedBytes)} />
      <SummaryMetric title="Резервные копии · файлы" sample={storage.backup} value={storage.backup.value ? formatCount(storage.backup.value.entries) : 'Нет измерения'} />
    </> : <Typography as="p" variant="bodySm" className="control-muted">Измерения хранилища недоступны.</Typography>}
    {sources?.map((source) => <div className="control-summary-source" key={source.id}><span><Typography as="span" variant="bodySm">{statusLabel(source.id)}</Typography></span><StatusBadge status={source.status} /></div>)}
  </div></CardContent></Card>
}
function SummaryMetric({ title, sample, value }: { title: string; sample: MetricSample<unknown>; value: string }) { return <div className="control-summary-metric"><span><Typography as="span" variant="bodySm">{title}</Typography></span><Typography as="strong" variant="emphasis">{value}</Typography><StatusBadge status={sample.status} /></div> }
function mergeSeries(data: Overview) { const registrations = new Map(data.registrations.map((row) => [row.day, row.count])); const activity = new Map(data.activity.map((row) => [row.day, row.count])); const days = new Set([...registrations.keys(), ...activity.keys()]); return [...days].sort().map((day) => ({ day, registrations: registrations.get(day) ?? 0, activity: activity.get(day) ?? null })) }
function eventTitle(type: string) { return ({ family_created: 'Создана семья', membership_joined: 'Добавлен участник', memory_published: 'Опубликовано воспоминание', source_state_changed: 'Изменилось состояние источника' } as Record<string,string>)[type] ?? 'Событие' }

function FamiliesPage({ api, enabled, onFamily }: { api: ReturnType<typeof controlApi>; enabled: boolean; onFamily: (id: string) => void }) {
  const [search, setSearch] = useState(''); const [settled, setSettled] = useState(''); const [status, setStatus] = useState(''); const [maxState, setMaxState] = useState(''); const [sort, setSort] = useState('createdAt')
  useEffect(() => { const timer = setTimeout(() => setSettled(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const params = { q: settled || undefined, status: status || undefined, maxState: maxState || undefined, sort }; const pager = usePageCursor(params)
  const q = useSectionQuery(['control','families',pager.resetKey,pager.cursor], ({ signal }) => api.families({ ...params, limit: 25, cursor: pager.cursor }, signal), enabled)
  const exportCsv = () => downloadCsv(api, 'families', params)
  return <><PageHeading title="Семьи" description="Семейные пространства, участники и измеряемое использование." action={<Button variant="outline" onClick={() => void exportCsv()}>Экспорт CSV</Button>} /><TableToolbar search={search} setSearch={setSearch} placeholder="Поиск по названию семьи"><FilterSelect label="Статус" value={status} setValue={setStatus} options={['active','deleting','deleted']} /><FilterSelect label="MAX" value={maxState} setValue={setMaxState} options={['configured','disconnected','unconfigured']} /><SortSelect value={sort} onChange={setSort} options={['createdAt','name','activeMembers','storageUsedBytes','lastObservedAt']} /></TableToolbar><DataTable loading={q.isLoading} error={q.error} isEmpty={!q.isLoading && !q.error && !q.data?.items.length} retry={() => void q.refetch()} empty="Семьи не найдены."><Table><TableHeader><TableRow><TableHead>Семья</TableHead><TableHead>Участники</TableHead><TableHead>Учтено</TableHead><TableHead>Воспоминания</TableHead><TableHead>MAX</TableHead><TableHead>Наблюдалась</TableHead></TableRow></TableHeader><TableBody>{q.data?.items.map((family) => <TableRow key={family.id} tabIndex={0} onClick={() => onFamily(family.id)} onKeyDown={(e) => activateRow(e, () => onFamily(family.id))}><TableCell><Typography as="strong" variant="emphasis">{family.name ?? 'Без названия'}</Typography><span className="control-cell-secondary"><StatusBadge status={family.lifecycleState} />{family.childName ? `Профиль: ${family.childName}` : `Создана ${fmtDate(family.createdAt)}`}</span></TableCell><TableCell>{formatCount(family.activeMembers)}</TableCell><TableCell>{formatBytes(family.storageUsedBytes)}<span className="control-cell-secondary"><Typography as="span" variant="bodySm">Квота {formatBytes(family.quotaBytes)}</Typography></span></TableCell><TableCell>{formatCount(family.publishedMemories)} <span className="control-cell-secondary"><Typography as="span" variant="bodySm">публикаций</Typography></span></TableCell><TableCell>{family.maxState ? <StatusBadge status={family.maxState} /> : '—'}</TableCell><TableCell>{family.lastObservedAt ? fmtDate(family.lastObservedAt) : 'Нет наблюдений'}</TableCell></TableRow>)}</TableBody></Table></DataTable><Pagination canPrevious={pager.canPrevious} hasNext={Boolean(q.data?.nextCursor)} previous={pager.previous} next={() => pager.next(q.data?.nextCursor ?? null)} /></>
}

function UsersPage({ api, enabled, onUser }: { api: ReturnType<typeof controlApi>; enabled: boolean; onUser: (id: string) => void }) {
  const [search, setSearch] = useState(''); const [settled, setSettled] = useState(''); const [sort, setSort] = useState('createdAt'); const [userState, setUserState] = useState('')
  useEffect(() => { const timer = setTimeout(() => setSettled(search.trim()), 300); return () => clearTimeout(timer) }, [search])
  const params = { q: settled || undefined, sort, userState: userState || undefined }; const pager = usePageCursor(params)
  const q = useSectionQuery(['control','users',pager.resetKey,pager.cursor], ({ signal }) => api.users({ ...params, limit: 25, cursor: pager.cursor }, signal), enabled)
  return <><PageHeading title="Пользователи" description="Активные аккаунты, корзина, очистка и наблюдаемые сигналы." action={<Button variant="outline" onClick={() => void downloadCsv(api, 'users', params)}>Экспорт CSV</Button>} /><TableToolbar search={search} setSearch={setSearch} placeholder="Поиск по имени"><FilterSelect label="Состояние" value={userState} setValue={setUserState} options={['active','trashed','purging']} /><SortSelect value={sort} onChange={setSort} options={['createdAt','name']} /></TableToolbar><DataTable loading={q.isLoading} error={q.error} isEmpty={!q.isLoading && !q.error && !q.data?.items.length} retry={() => void q.refetch()} empty="Пользователи не найдены."><Table><TableHeader><TableRow><TableHead>Учётная запись</TableHead><TableHead>Семьи</TableHead><TableHead>Создана</TableHead><TableHead>Последняя сессия</TableHead><TableHead>Последняя активность</TableHead><TableHead>Канал</TableHead></TableRow></TableHeader><TableBody>{q.data?.items.map((user) => <TableRow key={user.id} tabIndex={0} onClick={() => onUser(user.id)} onKeyDown={(e) => activateRow(e, () => onUser(user.id))}><TableCell><Typography as="strong" variant="emphasis">{user.displayName ?? 'Без имени'}</Typography><span className="control-cell-secondary"><StatusBadge status={user.lifecycleState} /><Typography as="span" variant="bodySm">{user.id} · аккаунт создан {fmtDate(user.createdAt)}</Typography></span></TableCell><TableCell>{formatCount(user.activeFamilies)}<span className="control-cell-secondary"><Typography as="span" variant="bodySm">{user.familyNames.join(', ')}</Typography>{user.moreFamilies ? ` и ещё ${user.moreFamilies}` : ''}</span></TableCell><TableCell>{fmtDate(user.createdAt)}</TableCell><TableCell>{fmtDate(user.lastSessionCreatedAt)}</TableCell><TableCell>{user.lastActivityAt ? fmtDate(user.lastActivityAt) : 'Нет сигналов'}</TableCell><TableCell>{user.lastActivitySurface ? surfaceLabel(user.lastActivitySurface) : '—'}</TableCell></TableRow>)}</TableBody></Table></DataTable><Pagination canPrevious={pager.canPrevious} hasNext={Boolean(q.data?.nextCursor)} previous={pager.previous} next={() => pager.next(q.data?.nextCursor ?? null)} /></>
}
function surfaceLabel(value: string) { return ({ max_mini_app: 'MAX Mini App', pwa: 'Web/PWA', browser: 'Браузер' } as Record<string,string>)[value] ?? value }
function ControlSelect({ value, onChange, options, ariaLabel }: { value: string; onChange: (value: string) => void; options: [string,string][]; ariaLabel: string }) { return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={ariaLabel} showIcon={false} className="control-native-select"><SelectValue /></SelectTrigger><SelectContent hideScrollIcons>{options.map(([option,label]) => <SelectItem hideCheckIcon key={option} value={option}>{label}</SelectItem>)}</SelectContent></Select> }
function FilterSelect({ label, value, setValue, options }: { label: string; value: string; setValue: (v: string) => void; options: string[] }) { const names: Record<string,string> = { active:'Активные', deleting:'Удаляются', deleted:'Удалены', trashed:'Корзина', purging:'Очистка', configured:'Подключён', disconnected:'Отключён', unconfigured:'Не настроен' }; return <label className="control-select-label"><span><Typography as="span" variant="bodySm">{label}</Typography></span><ControlSelect value={value || 'all'} onChange={(next) => setValue(next === 'all' ? '' : next)} ariaLabel={label} options={[["all","Все"], ...options.map((option) => [option, names[option] ?? option] as [string,string])]}/></label> }
function SortSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) { const names: Record<string,string> = { createdAt:'Дата создания', name:'Имя', activeMembers:'Число участников', storageUsedBytes:'Учтённый объём', lastObservedAt:'Наблюдаемая активность' }; return <label className="control-select-label"><span><Typography as="span" variant="bodySm">Сортировка</Typography></span><ControlSelect value={value} onChange={onChange} ariaLabel="Сортировка списка" options={options.map((option) => [option, names[option] ?? option] as [string,string])}/></label> }

function StoragePage({ api, enabled }: { api: ReturnType<typeof controlApi>; enabled: boolean }) { const q = useSectionQuery(['control','storage'], ({ signal }) => api.storage(signal), enabled); return <><PageHeading title="Хранилище" description="Раздельные измерения с указанием ресурса, его родительского объёма и основы учёта." /><QueryState loading={q.isLoading} error={q.error} retry={() => void q.refetch()}>{q.data && <div className="control-resource-grid">{([['Учёт семей',q.data.familyAccounting,'Суммарное использование; настроенная квота указана на одну семью'],['Логические объекты медиа',q.data.mediaStorage,'Инвентарь существующих объектов'],['Файловая система хоста',q.data.hostFilesystem,'Измерение пространства файловой системы'],['Размер PostgreSQL',q.data.postgres,'Размер базы; может входить в файловую систему хоста'],['Резервные копии',q.data.backup,'Файлы, артефакт и отдельные результаты проверок']] as const).map(([title,sample,subtitle]) => <ResourceCard key={title} title={title} sample={sample} subtitle={subtitle} />)}</div>}</QueryState></> }
function ResourceCard({ title, sample, subtitle }: { title: string; sample: MetricSample<Storage[keyof Storage]['value']>; subtitle: string }) {
  const value = sample.value as Record<string, unknown> | null
  const isFamilyAccounting = 'quotaBytes' in (value ?? {})
  return <Card className="control-resource-card"><CardHeader><div className="control-card-title-line"><CardTitle>{title}</CardTitle><StatusBadge status={sample.status} /></div><CardDescription>{subtitle}</CardDescription></CardHeader><CardContent>{value ? <dl className="control-data-list">
    <DataPair label="Учтено" value={formatBytes(String(value.usedBytes ?? ''))} />
    {!isFamilyAccounting && <DataPair label="Ёмкость" value={formatBytes(value.capacityBytes as string | null)} />}
    {!isFamilyAccounting && <DataPair label="Свободно" value={formatBytes(value.availableBytes as string | null)} />}
    {'quotaBytes' in value && <DataPair label="Квота одной семьи" value={formatBytes(value.quotaBytes as string | null)} />}
    {'reservedBytes' in value && <DataPair label="Зарезервировано" value={formatBytes(value.reservedBytes as string)} />}
    {'entries' in value && <DataPair label="Файлов" value={formatCount(value.entries as number)} />}
    {'artifactAt' in value && <DataPair label="Артефакт создан" value={fmtDate(value.artifactAt as string | null)} />}
    {'validation' in value && <DataPair label="Структурная проверка" value={statusLabel(value.validation as string)} />}
    {'restoreTestAt' in value && <DataPair label="Последний тест восстановления" value={fmtDate(value.restoreTestAt as string | null)} />}
    <DataPair label="Тип ёмкости" value={capacityKindLabel(value.capacityKind as string)} />
    <DataPair label="Основа учёта" value={accountingBasisLabel(value.accountingBasis)} />
    <DataPair label="Ресурс" value={resourceLabel(value.resourceId ?? sample.sourceId)} />
    <DataPair label="Родительский ресурс" value={value.parentResourceId ? resourceLabel(value.parentResourceId) : 'Нет / не указан'} />
  </dl> : <Typography as="p" variant="bodySm" className="control-muted">Для этого источника измерение недоступно.</Typography>}<div className="control-resource-meta"><span><Typography as="span" variant="bodySm">Источник: {statusLabel(sample.sourceId)}</Typography></span><span><Typography as="span" variant="bodySm">Измерено: {sourceTime(sample)}</Typography></span></div><Typography as="p" variant="bodySm" className="control-footnote">{value?.scopeLabel ? accountingBasisLabel(value.scopeLabel) : 'Ёмкость неизвестна, проценты не рассчитываются.'}</Typography></CardContent></Card>
}
function DataPair({ label, value }: { label: string; value: string }) { return <div><dt><Typography as="span" variant="bodySm">{label}</Typography></dt><dd><Typography as="span" variant="bodySm">{value}</Typography></dd></div> }
function SourcesPage({ api, enabled }: { api: ReturnType<typeof controlApi>; enabled: boolean }) { const q = useSectionQuery(['control','sources'], ({ signal }) => api.sources(signal), enabled); const names: Record<string,string> = { product_db:'База продукта', media_storage:'Хранилище медиа', host_filesystem:'Файловая система', postgres_size:'Размер PostgreSQL', backup_storage:'Резервные копии', service_probes:'Проверки сервисов', max_binding_state:'Состояние MAX', release_evidence:'Сведения о выпуске' }; return <><PageHeading title="Подключения" description="Статус настроенных источников, последняя попытка и время успешного измерения." /><QueryState loading={q.isLoading} error={q.error} retry={() => void q.refetch()}>{q.data && <div className="control-resource-grid">{q.data.map((source) => <SourceCard key={source.id} source={source} title={names[source.id] ?? source.id} />)}</div>}</QueryState></> }
function SourceCard({ source, title }: { source: Source; title: string }) { return <Card className="control-source-card"><CardHeader><div className="control-card-title-line"><CardTitle>{title}</CardTitle><StatusBadge status={source.status} /></div><CardDescription>Тип источника: {statusLabel(source.kind)}</CardDescription></CardHeader><CardContent><dl className="control-data-list"><DataPair label="Последний успех" value={fmtDate(source.observedAt)} /><DataPair label="Последняя попытка" value={fmtDate(source.lastAttemptAt)} /><DataPair label="Код ошибки" value={source.errorCode ? errorCodeLabel(source.errorCode) : 'Нет'}/></dl><Typography as="p" variant="bodySm" className="control-footnote">{source.errorCode ? 'Показан безопасный фиксированный статус без текста исключения.' : 'Адреса подключений и секреты не выводятся.'}</Typography></CardContent></Card> }
function errorCodeLabel(code: string) { return ({ timeout:'Тайм-аут', unavailable:'Источник недоступен', invalid_payload:'Некорректный ответ', permission_denied:'Недостаточно прав', unknown:'Неизвестная ошибка' } as Record<string,string>)[code] ?? 'Ошибка' }
function SystemPage({ api, enabled }: { api: ReturnType<typeof controlApi>; enabled: boolean }) { const q = useSectionQuery(['control','system'], ({ signal }) => api.system(signal), enabled); return <><PageHeading title="Состояние системы" description="Проверки готовности и признаки работы фоновых процессов." /><QueryState loading={q.isLoading} error={q.error} retry={() => void q.refetch()}>{q.data && <div className="control-system-grid"><SystemSample title="Backend" sample={q.data.backend} value={q.data.backend.value ? q.data.backend.value.ready ? 'Готов' : 'Не готов' : 'Нет измерения'} detail={q.data.backend.value ? `Проба готовности ${q.data.backend.value.readinessProbeLatencyMs ?? '—'} мс` : ''} /><SystemSample title="Статическая страница" sample={q.data.staticEntry} value={q.data.staticEntry.value ? q.data.staticEntry.value.available ? 'Доступна' : 'Не отвечает' : 'Нет измерения'} detail={q.data.staticEntry.value ? `Проба ${q.data.staticEntry.value.probeLatencyMs ?? '—'} мс` : ''} /><SystemSample title="PostgreSQL" sample={q.data.postgresSizeBytes} value={formatBytes(q.data.postgresSizeBytes.value)} detail="Размер базы данных" /><SystemSample title="Worker" sample={q.data.worker} value={q.data.worker.value?.progressAt ? 'Есть прогресс' : 'Нет прогресса'} detail={`Последний прогресс: ${fmtDate(q.data.worker.value?.progressAt ?? null)}`} /><SystemSample title="Планировщик" sample={q.data.scheduler} value={q.data.scheduler.value?.progressAt ? 'Есть прогресс' : 'Нет прогресса'} detail={`Последний прогресс: ${fmtDate(q.data.scheduler.value?.progressAt ?? null)}`} /><SystemSample title="Очередь outbox" sample={q.data.outbox} value={q.data.outbox.value ? formatCount(q.data.outbox.value.pending) : '—'} detail={q.data.outbox.value?.oldestDueAgeSeconds === null || !q.data.outbox.value ? 'Возраст старейшей задачи не измерен' : `Старейшая задача: ${formatCount(q.data.outbox.value.oldestDueAgeSeconds)} сек.`} /><SystemSample title="Выпуск" sample={q.data.release} value={q.data.release.value ? 'Миграции актуальны' : 'Сведения недоступны'} detail={q.data.release.value ? `Backend ${q.data.release.value.backendSha.slice(0,8)} · Static ${q.data.release.value.staticSha.slice(0,8)} · ${fmtDate(q.data.release.value.lastSuccessfulReleaseAt)}` : 'Нет подтверждённого release evidence'} /></div>}</QueryState><Typography as="p" variant="bodySm" className="control-footnote">Время ответа пробы не является p95 или SLA. Наблюдаемое состояние не доказывает глобальный uptime.</Typography></> }
function SystemSample({ title, sample, value, detail }: { title: string; sample: MetricSample<unknown>; value: string; detail: string }) { return <Card><CardHeader><div className="control-card-title-line"><CardTitle>{title}</CardTitle><StatusBadge status={sample.status} /></div></CardHeader><CardContent><Typography as="strong" variant="emphasis" className="control-system-value">{value}</Typography><Typography as="p" variant="bodySm">{detail}</Typography><Typography as="small" variant="caption">Последнее измерение: {sourceTime(sample)}</Typography></CardContent></Card> }

function DataTable({ loading, error, isEmpty, retry, empty, children }: { loading: boolean; error: unknown; isEmpty: boolean; retry: () => void; empty: string; children: ReactNode }) { if (loading) return <div className="control-table-scroll"><Skeleton className="h-64" /></div>; if (error) return <QueryState loading={false} error={error} retry={retry}><>{children}</></QueryState>; return <div className="control-table-scroll">{isEmpty ? <Empty className="control-empty"><EmptyHeader><EmptyTitle>{empty}</EmptyTitle><EmptyDescription>Попробуйте изменить поиск или фильтры.</EmptyDescription></EmptyHeader></Empty> : children}</div> }

function FamilyDetail({ api, familyId, onClose, onUser, portalContainer, enabled }: { api: ReturnType<typeof controlApi>; familyId: string | null; onClose: () => void; onUser: (id: string) => void; portalContainer: HTMLElement | null; enabled: boolean }) {
  const open = Boolean(familyId); const memberPager = usePageCursor({ q: familyId ?? '' }); const invitePager = usePageCursor({ q: familyId ?? '' }); const family = useSectionQuery(['control','family',familyId], ({ signal }) => api.family(familyId!, signal), enabled && open); const members = useSectionQuery(['control','family-members',familyId,memberPager.cursor], ({ signal }) => api.familyMembers(familyId!, { limit: 25, cursor: memberPager.cursor }, signal), enabled && open); const invites = useSectionQuery(['control','family-invites',familyId,invitePager.cursor], ({ signal }) => api.familyInvites(familyId!, { limit: 25, cursor: invitePager.cursor }, signal), enabled && open)
  return <Sheet open={open} onOpenChange={(value) => { if (!value) onClose() }}><SheetContent className="control-detail-sheet" showCloseButton={false} portalContainer={portalContainer}><SheetHeader><div className="control-sheet-heading"><div><Typography as="p" variant="bodySm" className="control-eyebrow">СЕМЬЯ</Typography><SheetTitle>{family.data?.name ?? (family.isLoading ? 'Загружаем семью…' : 'Семья')}</SheetTitle></div><Button variant="outline" onClick={onClose}>Закрыть</Button></div><SheetDescription>Метаданные семьи и отдельные списки участников и приглашений.</SheetDescription></SheetHeader><div className="control-detail-body">{family.isLoading ? <Skeleton className="h-32" /> : family.data ? <><dl className="control-detail-grid"><DataPair label="Состояние" value={statusLabel(family.data.lifecycleState)} /><DataPair label="Операция" value={family.data.operationStatus ? statusLabel(family.data.operationStatus) : 'Нет'} /><DataPair label="Ошибка очистки" value={family.data.errorCode ? errorCodeLabel(family.data.errorCode) : 'Нет'} /><DataPair label="Владелец семьи" value={family.data.ownerName ?? 'Не указан'} /><DataPair label="Профиль ребёнка" value={family.data.childName ?? 'Нет'} /><DataPair label="Создана" value={fmtDate(family.data.createdAt)} /><DataPair label="Учтено / резерв" value={`${formatBytes(family.data.storageUsedBytes)} / ${formatBytes(family.data.storageReservedBytes)}`} /><DataPair label="Квота" value={formatBytes(family.data.quotaBytes)} /><DataPair label="Подключение MAX" value={family.data.maxState ? statusLabel(family.data.maxState) : 'Нет подключения'} /><DataPair label="Проверено MAX" value={fmtDate(family.data.maxLastCheckedAt)} /><DataPair label="Наблюдалась активность" value={fmtDate(family.data.lastObservedAt)} /></dl><FamilyLifecycleActions api={api} family={family.data} enabled={enabled && open} portalContainer={portalContainer} /><Card><CardHeader><CardTitle>Участники</CardTitle><CardDescription>{formatCount(family.data.activeMembers)} активных связей</CardDescription></CardHeader><CardContent>{members.isLoading ? <Skeleton className="h-20" /> : members.error ? <ChildError retry={() => void members.refetch()} /> : members.data?.items.length ? members.data.items.map((member: FamilyMember) => <button className="control-detail-row" key={member.userId} onClick={() => onUser(member.userId)}><span><Typography as="strong" variant="emphasis">{member.alias ?? member.displayName ?? 'Без имени'}</Typography><Typography as="small" variant="caption">{member.alias ? `Аккаунт: ${member.displayName ?? 'Без имени'}` : 'Имя аккаунта'}</Typography></span><span><Typography as="span" variant="bodySm">{member.isOwner ? 'Владелец' : member.role === 'full' ? 'Полный доступ' : 'Просмотр'}</Typography></span></button>) : <Typography as="p" variant="bodySm" className="control-muted">Участников нет.</Typography>}<ChildPage page={members.data} pager={memberPager} /></CardContent></Card><Card><CardHeader><CardTitle>Приглашения</CardTitle><CardDescription>Только состояние и даты, без ссылок и кодов.</CardDescription></CardHeader><CardContent>{invites.isLoading ? <Skeleton className="h-20" /> : invites.error ? <ChildError retry={() => void invites.refetch()} /> : invites.data?.items.length ? invites.data.items.map((invite: Invite) => <div className="control-detail-row" key={invite.id}><span><Typography as="strong" variant="emphasis">{invite.state === 'pending' ? 'Ожидает принятия' : invite.state === 'accepted' ? 'Принято' : invite.state === 'expired' ? 'Истекло' : 'Отозвано'}</Typography><Typography as="small" variant="caption">Создано {fmtDate(invite.createdAt)}</Typography></span><Typography as="small" variant="caption">До {fmtDate(invite.expiresAt)}</Typography></div>) : <Typography as="p" variant="bodySm" className="control-muted">Приглашений нет.</Typography>}<ChildPage page={invites.data} pager={invitePager} /></CardContent></Card></> : <Typography as="p" variant="bodySm" className="control-inline-error">Не удалось загрузить детали семьи.</Typography>}</div></SheetContent></Sheet>
}

function UserDetail({ api, userId, onClose, portalContainer, enabled }: { api: ReturnType<typeof controlApi>; userId: string | null; onClose: () => void; portalContainer: HTMLElement | null; enabled: boolean }) { const open = Boolean(userId); const pager = usePageCursor({ q: userId ?? '' }); const user = useSectionQuery(['control','user',userId], ({ signal }) => api.user(userId!, signal), enabled && open); const memberships = useSectionQuery(['control','user-memberships',userId,pager.cursor], ({ signal }) => api.userMemberships(userId!, { limit: 25, cursor: pager.cursor }, signal), enabled && open); return <Sheet open={open} onOpenChange={(value) => { if (!value) onClose() }}><SheetContent className="control-detail-sheet" showCloseButton={false} portalContainer={portalContainer}><SheetHeader><div className="control-sheet-heading"><div><Typography as="p" variant="bodySm" className="control-eyebrow">ПОЛЬЗОВАТЕЛЬ</Typography><SheetTitle>{user.data?.displayName ?? (user.isLoading ? 'Загружаем пользователя…' : 'Учётная запись')}</SheetTitle></div><Button variant="outline" onClick={onClose}>Закрыть</Button></div><SheetDescription>Сессии и активность — отдельные наблюдаемые факты.</SheetDescription></SheetHeader><div className="control-detail-body">{user.data ? <><UserLifecycleActions api={api} user={user.data} enabled={enabled && open} portalContainer={portalContainer} /><dl className="control-detail-grid"><DataPair label="Создан" value={fmtDate(user.data.createdAt)} /><DataPair label="Активные семьи" value={formatCount(user.data.activeFamilies)} /><DataPair label="Последняя сессия создана" value={fmtDate(user.data.lastSessionCreatedAt)} /><DataPair label="Последний сигнал активности" value={fmtDate(user.data.lastActivityAt)} /><DataPair label="Поверхность активности" value={user.data.lastActivitySurface ? surfaceLabel(user.data.lastActivitySurface) : 'Не наблюдалась'} /></dl><Card><CardHeader><CardTitle>Членства</CardTitle><CardDescription>Роль и признак владельца показаны отдельно.</CardDescription></CardHeader><CardContent>{memberships.isLoading ? <Skeleton className="h-20" /> : memberships.error ? <ChildError retry={() => void memberships.refetch()} /> : memberships.data?.items.length ? memberships.data.items.map((membership: Membership) => <div className="control-detail-row" key={membership.familyId}><span><Typography as="strong" variant="emphasis">{membership.familyName ?? 'Семья без названия'}</Typography><Typography as="small" variant="caption">{membership.alias ? `Отображаемое имя: ${membership.alias}` : 'Нет семейного псевдонима'}</Typography></span><span><Typography as="span" variant="bodySm">{membership.isOwner ? 'Владелец' : membership.role === 'full' ? 'Полный доступ' : 'Просмотр'}</Typography></span></div>) : <Typography as="p" variant="bodySm" className="control-muted">Активных членств нет.</Typography>}<ChildPage page={memberships.data} pager={pager} /></CardContent></Card></> : user.isLoading ? <Skeleton className="h-36" /> : <Typography as="p" variant="bodySm" className="control-inline-error">Не удалось загрузить пользователя.</Typography>}</div></SheetContent></Sheet> }

function UserLifecycleActions({ api, user, enabled, portalContainer }: { api: ReturnType<typeof controlApi>; user: UserRow; enabled: boolean; portalContainer: HTMLElement | null }) {
  const queryClient = useQueryClient()
  const preview = useSectionQuery(['control','user-deletion-preview',user.id], ({ signal }) => api.userDeletionPreview(user.id, signal), enabled)
  const [dialog, setDialog] = useState<'trash' | 'restore' | null>(null)
  const [typed, setTyped] = useState('')
  const [commandKey, setCommandKey] = useState<string | null>(null)
  const [dialogFingerprint, setDialogFingerprint] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const visibleTyped = dialogFingerprint === preview.data?.fingerprint ? typed : ''
  const begin = (next: 'trash' | 'restore') => { setMessage(''); setTyped(''); setCommandKey(crypto.randomUUID()); setDialogFingerprint(preview.data?.fingerprint ?? null); setDialog(next) }
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['control'] }) }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || !commandKey || !preview.data || (dialog === 'trash' && visibleTyped !== 'УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ')) return
    setPending(true); setMessage('')
    try {
      if (dialog === 'trash') {
        await api.trashUser(user.id, { key: commandKey, fingerprint: preview.data.fingerprint, confirmation: preview.data.confirmation })
      } else if (dialog === 'restore' && preview.data.canRestore && preview.data.deletionId) {
        await api.restoreUser(user.id, { key: commandKey, deletionId: preview.data.deletionId })
      } else return
      setDialog(null); setTyped(''); setMessage(''); refresh()
    } catch (error) {
      if (isAccessError(error)) { window.dispatchEvent(new CustomEvent('control-access-error', { detail: error })); return }
      setMessage(mutationMessage(error))
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') {
        setTyped(''); setCommandKey(crypto.randomUUID())
      }
      refresh()
    } finally { setPending(false) }
  }
  const name = user.displayName ?? 'Без имени'
  return <>
    <Card className="control-lifecycle-card"><CardHeader><div className="control-card-title-line"><CardTitle>Состояние аккаунта</CardTitle><StatusBadge status={user.lifecycleState} /></div><CardDescription>{user.operationStatus ? `Операция: ${statusLabel(user.operationStatus)}` : 'Стандартный доступ к сервису.'}</CardDescription></CardHeader><CardContent>
      {user.errorCode && <Alert variant="destructive"><AlertTitle>Не удалось завершить очистку</AlertTitle><AlertDescription>{errorCodeLabel(user.errorCode)}</AlertDescription></Alert>}
      {preview.isLoading ? <Skeleton className="h-12" /> : preview.error ? <div className="control-child-error"><Typography as="span" variant="bodySm">Не удалось проверить состояние удаления.</Typography><Button variant="link" onClick={() => void preview.refetch()}>Повторить</Button></div> : user.lifecycleState === 'active' ? <>{preview.data?.protectedAccount ? <Typography as="p" variant="bodySm" className="control-muted">Аккаунты владельцев Control защищены от удаления.</Typography> : <Button variant="destructive" disabled={!preview.data?.canTrash} onClick={() => begin('trash')}>Удалить пользователя</Button>}</> : user.lifecycleState === 'trashed' ? <div className="control-lifecycle-actions"><Typography as="p" variant="bodySm">В корзине до {fmtDate(preview.data?.purgeAfter ?? user.purgeAfter)}. Доступ закрыт; сохранённый архив удалится по сроку.</Typography><Button variant="outline" disabled={!preview.data?.canRestore || !preview.data.deletionId} onClick={() => begin('restore')}>Восстановить</Button>{!preview.data?.canRestore && <Typography as="small" variant="caption">Восстановление уже недоступно.</Typography>}</div> : <Typography as="p" variant="bodySm" className="control-muted">Идёт окончательная очистка. Восстановление недоступно.</Typography>}
    </CardContent></Card>
    <Dialog open={dialog === 'trash'} onOpenChange={(open) => { if (!open && !pending) { setDialog(null); setTyped(''); setDialogFingerprint(null); setMessage('') } }}><DialogContent className="control-lifecycle-dialog" portalContainer={portalContainer} showCloseButton={false}><DialogHeader><DialogTitle>Удалить пользователя</DialogTitle><DialogDescription>Проверьте охват и введите точную фразу подтверждения.</DialogDescription></DialogHeader>
      {preview.data ? <div className="control-lifecycle-impact"><Typography as="strong" variant="emphasis">{name}</Typography><Typography as="code" variant="code">{user.id}</Typography><dl><div><Typography as="dt" variant="bodySm">Семьи в архиве</Typography><Typography as="dd" variant="bodySm">{formatCount(preview.data.families)} ({formatCount(preview.data.activeFamilies)} активных)</Typography></div><div><Typography as="dt" variant="bodySm">Закрываемых доступов к семьям</Typography><Typography as="dd" variant="bodySm">{formatCount(preview.data.members)}</Typography></div><div><Typography as="dt" variant="bodySm">Воспоминания</Typography><Typography as="dd" variant="bodySm">{formatCount(preview.data.memories)}</Typography></div><div><Typography as="dt" variant="bodySm">Учтённое хранилище</Typography><Typography as="dd" variant="bodySm">{formatBytes(preview.data.storageUsedBytes)}</Typography></div></dl><Typography as="code" variant="code" className="control-lifecycle-fingerprint">Предпросмотр: {preview.data.fingerprint}</Typography></div> : <Skeleton className="h-28" />}
      <Alert variant="destructive"><AlertTitle>Доступ участников изменится сразу</AlertTitle><AlertDescription>Ваши собственные семьи немедленно станут недоступны всем участникам. Архив хранится 30 дней. Сессии и неиспользованные приглашения не восстанавливаются. Отдельно удалённую семью вернуть нельзя.</AlertDescription></Alert>
      <form onSubmit={submit} className="control-lifecycle-form"><label htmlFor="control-trash-confirm"><Typography as="span" variant="label">Введите УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ</Typography></label><Input id="control-trash-confirm" value={visibleTyped} onChange={(event) => { setDialogFingerprint(preview.data?.fingerprint ?? null); setTyped(event.target.value) }} aria-invalid={visibleTyped !== '' && visibleTyped !== 'УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ'} aria-describedby={message ? 'control-trash-error' : undefined} autoComplete="off" disabled={pending} /><Typography as="small" variant="caption">Цель: {name} · {user.id}</Typography>{message && <Typography id="control-trash-error" as="p" variant="bodySm" role="alert" className="control-inline-error">{message}</Typography>}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>Отмена</Button><Button type="submit" variant="destructive" disabled={pending || !preview.data?.canTrash || visibleTyped !== 'УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ'}>{pending ? 'Удаляем…' : 'Переместить в корзину'}</Button></DialogFooter></form>
    </DialogContent></Dialog>
    <Dialog open={dialog === 'restore'} onOpenChange={(open) => { if (!open && !pending) { setDialog(null); setMessage('') } }}><DialogContent className="control-lifecycle-dialog" portalContainer={portalContainer} showCloseButton={false}><DialogHeader><DialogTitle>Восстановить пользователя</DialogTitle><DialogDescription>Восстановятся только доступы, которые не отзывали отдельно и для которых срок ещё действует.</DialogDescription></DialogHeader><form onSubmit={submit} className="control-lifecycle-form"><div className="control-lifecycle-impact"><Typography as="strong" variant="emphasis">{name}</Typography><Typography as="code" variant="code">{user.id}</Typography><Typography as="span" variant="bodySm">Цикл удаления: {preview.data?.deletionId ?? user.deletionId ?? 'Недоступен'}</Typography><Typography as="span" variant="bodySm">Срок: {fmtDate(preview.data?.purgeAfter ?? user.purgeAfter)}</Typography></div>{message && <Typography as="p" variant="bodySm" role="alert" className="control-inline-error">{message}</Typography>}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setDialog(null)}>Отмена</Button><Button type="submit" disabled={pending || !preview.data?.canRestore || !preview.data.deletionId}>{pending ? 'Восстанавливаем…' : 'Восстановить'}</Button></DialogFooter></form></DialogContent></Dialog>
  </>
}

function FamilyLifecycleActions({ api, family, enabled, portalContainer }: { api: ReturnType<typeof controlApi>; family: FamilyRow; enabled: boolean; portalContainer: HTMLElement | null }) {
  const queryClient = useQueryClient()
  const preview = useSectionQuery(['control','family-deletion-preview',family.id], ({ signal }) => api.familyDeletionPreview(family.id, signal), enabled)
  const [open, setOpen] = useState(false); const [typed, setTyped] = useState(''); const [commandKey, setCommandKey] = useState<string | null>(null); const [dialogFingerprint, setDialogFingerprint] = useState<string | null>(null); const [message, setMessage] = useState(''); const [pending, setPending] = useState(false)
  const visibleTyped = dialogFingerprint === preview.data?.fingerprint ? typed : ''
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['control'] }) }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || !commandKey || !preview.data || visibleTyped !== 'УДАЛИТЬ НАВСЕГДА') return
    setPending(true); setMessage('')
    try {
      await api.purgeFamily(family.id, { key: commandKey, fingerprint: preview.data.fingerprint, confirmation: preview.data.confirmation })
      setOpen(false); setTyped(''); refresh()
    } catch (error) {
      if (isAccessError(error)) { window.dispatchEvent(new CustomEvent('control-access-error', { detail: error })); return }
      setMessage(mutationMessage(error))
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') { setTyped(''); setCommandKey(crypto.randomUUID()) }
      refresh()
    } finally { setPending(false) }
  }
  const canPurge = family.lifecycleState === 'active' || family.lifecycleState === 'trashed' || family.lifecycleState === 'inactive'
  return <>
    <Card className="control-lifecycle-card"><CardHeader><div className="control-card-title-line"><CardTitle>Удаление семьи</CardTitle><StatusBadge status={family.lifecycleState} /></div><CardDescription>{family.deletionId ? `Цикл: ${family.deletionId}` : 'Отдельное удаление без возможности восстановления.'}</CardDescription></CardHeader><CardContent>{family.errorCode && <Alert variant="destructive"><AlertTitle>Очистка приостановлена с ошибкой</AlertTitle><AlertDescription>{errorCodeLabel(family.errorCode)}</AlertDescription></Alert>}{family.lifecycleState === 'purging' ? <Typography as="p" variant="bodySm">Доступ уже закрыт; физическая очистка продолжается.</Typography> : <>{family.lifecycleState === 'inactive' && <Typography as="p" variant="bodySm">Семья помечена неактивной вне цикла корзины Control; восстановление недоступно.</Typography>}<Button variant="destructive" disabled={!canPurge || !preview.data || preview.isLoading} onClick={() => { setTyped(''); setMessage(''); setCommandKey(crypto.randomUUID()); setDialogFingerprint(preview.data?.fingerprint ?? null); setOpen(true) }}>Удалить семью навсегда</Button></>}</CardContent></Card>
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) { setOpen(false); setTyped(''); setDialogFingerprint(null); setMessage('') } }}><DialogContent className="control-lifecycle-dialog" portalContainer={portalContainer} showCloseButton={false}><DialogHeader><DialogTitle>Удалить семью навсегда</DialogTitle><DialogDescription>Семья будет сразу закрыта всем участникам. Физическая очистка файлов может продолжаться после команды.</DialogDescription></DialogHeader>
      {preview.data ? <div className="control-lifecycle-impact"><Typography as="strong" variant="emphasis">{family.name ?? 'Без названия'}</Typography><Typography as="code" variant="code">{family.id}</Typography><dl><div><Typography as="dt" variant="bodySm">Участники</Typography><Typography as="dd" variant="bodySm">{formatCount(preview.data.members)}</Typography></div><div><Typography as="dt" variant="bodySm">Воспоминания</Typography><Typography as="dd" variant="bodySm">{formatCount(preview.data.memories)}</Typography></div><div><Typography as="dt" variant="bodySm">Учтённое хранилище</Typography><Typography as="dd" variant="bodySm">{formatBytes(preview.data.storageUsedBytes)}</Typography></div></dl><Typography as="code" variant="code" className="control-lifecycle-fingerprint">Предпросмотр: {preview.data.fingerprint}</Typography></div> : preview.error ? <Alert variant="destructive"><AlertTitle>Предпросмотр недоступен</AlertTitle><AlertDescription>{mutationMessage(preview.error)}</AlertDescription></Alert> : <Skeleton className="h-24" />}
      <Alert variant="destructive"><AlertTitle>Действие необратимо</AlertTitle><AlertDescription>Архив этой семьи удаляется без ожидания 30 дней. Все участники теряют доступ сразу; восстановление аккаунта владельца не вернёт эту семью.</AlertDescription></Alert>
      <form onSubmit={submit} className="control-lifecycle-form"><label htmlFor="control-family-purge-confirm"><Typography as="span" variant="label">Введите УДАЛИТЬ НАВСЕГДА</Typography></label><Input id="control-family-purge-confirm" value={visibleTyped} onChange={(event) => { setDialogFingerprint(preview.data?.fingerprint ?? null); setTyped(event.target.value) }} aria-invalid={visibleTyped !== '' && visibleTyped !== 'УДАЛИТЬ НАВСЕГДА'} aria-describedby={message ? 'control-family-purge-error' : undefined} autoComplete="off" disabled={pending} /><Typography as="small" variant="caption">Цель: {family.name ?? 'Без названия'} · {family.id}</Typography>{message && <Typography id="control-family-purge-error" as="p" variant="bodySm" role="alert" className="control-inline-error">{message}</Typography>}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button><Button type="submit" variant="destructive" disabled={pending || !preview.data || visibleTyped !== 'УДАЛИТЬ НАВСЕГДА'}>{pending ? 'Начинаем очистку…' : 'Удалить навсегда'}</Button></DialogFooter></form>
    </DialogContent></Dialog>
  </>
}

function mutationMessage(error: unknown) { if (error instanceof ApiRequestError) return error.message; return 'Не удалось подтвердить результат. Состояние обновлено; проверьте карточку перед повтором.' }

function ChildPage({ page, pager }: { page: { nextCursor: string | null } | undefined; pager: ReturnType<typeof usePageCursor> }) { return <Pagination canPrevious={pager.canPrevious} hasNext={Boolean(page?.nextCursor)} previous={pager.previous} next={() => pager.next(page?.nextCursor ?? null)} /> }
function ChildError({ retry }: { retry: () => void }) { return <div className="control-child-error"><span><Typography as="span" variant="bodySm">Не удалось загрузить список.</Typography></span><Button variant="link" onClick={retry}>Повторить</Button></div> }

function CommandPalette({ api, open, query, setQuery, onClose, onFamily, onUser, portalContainer, enabled }: { api: ReturnType<typeof controlApi>; open: boolean; query: string; setQuery: (value: string) => void; onClose: () => void; onFamily: (id: string) => void; onUser: (id: string) => void; portalContainer: HTMLElement | null; enabled: boolean }) {
  const [settled, setSettled] = useState(''); useEffect(() => { const timer = setTimeout(() => setSettled(query.trim()), 300); return () => clearTimeout(timer) }, [query])
  const currentQuery = settled === query.trim() ? settled : ''
  const result = useQuery({ queryKey: ['control','command',currentQuery], enabled: enabled && open && currentQuery.length > 0, retry: false, queryFn: async ({ signal }) => Promise.all([api.families({ q: currentQuery, limit: 6, sort: 'name' }, signal), api.users({ q: currentQuery, limit: 6, sort: 'name' }, signal)]) })
  return <CommandDialog open={open} onOpenChange={(value) => { if (!value) onClose() }} title="Поиск по панели" description="Поиск семей и пользователей на сервере." className="control-command-dialog" portalContainer={portalContainer} showCloseButton><Command shouldFilter={false} className="control-command"><CommandInput showSearchIcon={false} value={query} onValueChange={setQuery} placeholder="Введите имя семьи или пользователя" aria-label="Поиск семей и пользователей" /><CommandList aria-live="polite">{query.trim().length < 2 ? <CommandEmpty>Введите не менее двух символов.</CommandEmpty> : result.isLoading ? <div className="control-command-state"><Skeleton className="h-16" /></div> : result.error ? <div className="control-command-state control-inline-error"><Typography as="span" variant="bodySm">Поиск временно недоступен.</Typography></div> : <>{!result.data?.[0].items.length && !result.data?.[1].items.length ? <CommandEmpty>Ничего не найдено.</CommandEmpty> : <>{Boolean(result.data?.[0].items.length) && <CommandGroup heading="Семьи">{result.data?.[0].items.map((row: FamilyRow) => <CommandItem key={row.id} value={`family ${row.name ?? ''}`} hideCheckIcon onSelect={() => onFamily(row.id)}><WebpIcon decorative monochrome name="family" size={18} />{row.name ?? 'Без названия'}</CommandItem>)}</CommandGroup>}{Boolean(result.data?.[1].items.length) && <CommandGroup heading="Пользователи">{result.data?.[1].items.map((row: UserRow) => <CommandItem key={row.id} value={`user ${row.displayName ?? ''}`} hideCheckIcon onSelect={() => onUser(row.id)}><WebpIcon decorative monochrome name="user" size={18} />{row.displayName ?? 'Без имени'}<Typography as="small" variant="caption">{formatCount(row.activeFamilies)} семьи</Typography></CommandItem>)}</CommandGroup>}</>}</>}</CommandList></Command></CommandDialog>
}

function activateRow(event: React.KeyboardEvent, activate: () => void) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }
async function downloadCsv(api: ReturnType<typeof controlApi>, kind: 'families' | 'users', params: ListParams) { const controller = new AbortController(); activeExports.add(controller); try { const response = await api.exportCsv(kind, params, controller.signal); const blob = await response.blob(); if (controller.signal.aborted) return; if (blob.size > 10 * 1024 * 1024) throw new Error('export too large'); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `memoly-${kind}-${new Date().toISOString().slice(0,10)}.csv`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) } catch (error) { if (controller.signal.aborted) return; if (isAccessError(error)) window.dispatchEvent(new CustomEvent('control-access-error', { detail: error })); else window.dispatchEvent(new CustomEvent('control-export-error')) } finally { activeExports.delete(controller) } }
function isAccessError(error: unknown) { return error instanceof ApiRequestError && (error.status === 401 || error.status === 403) }
function sectionFromHash(): Section { const value = location.hash.replace(/^#\/?/, '') as Section; return SECTIONS.some((item) => item.id === value) ? value : 'overview' }
