import type { CSSProperties } from 'react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserLinkStartResponse, FamilyInviteDto, FamilyMemberDto, FamilyResponse, InvitePreviewResponse } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { FeedPage, InlineError, type FeedFilter } from '@/features/feed'
import { AuthContext, shouldKeepHostAuthPreloader, useHostAuthHandoff, type HostAuthProvider } from '@/features/auth'
import { BootPreloader, decideStartupRoute } from '@/features/app'
import {
  acceptInvite,
  createFamilyBootstrap,
  createFamilyErrorMessage,
  feedChildSubtitle,
  FamilyOnboarding,
  FamilyScreen,
  loadFamily,
  loadFamilyInvites,
  loadFamilyMe,
  loadFamilyMembers,
  inviteIssueCode,
  IncomingInvite,
  IncomingInviteIssue,
  previewInvite,
} from '@/features/family'
import type { HostBridge } from '@/platform/telegram'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'
import type { AuthenticatedTransport } from '@/platform/api'
import { isMaxVideoUploadAcceptanceLaunch, readMaxRuntimeDiagnostic, shouldShowMaxRuntimeDiagnostic, type MaxRuntimeDiagnostic } from '@/platform/max/host-bridge'
import { createMaxBrowserLink, maxBrowserLinkChallengeId } from '@/platform/max/host-bridge'
import { ThemeProvider } from '@/features/theme'

export type AppProps = { hostBridge: HostBridge }

export default function App(props: AppProps) {
  return (
    <ThemeProvider>
      <AppContent {...props} />
    </ThemeProvider>
  )
}

function AppContent({ hostBridge }: AppProps) {
  const auth = useContext(AuthContext)
  const maxBrowserChallengeId = hostBridge.kind === 'max'
    ? maxBrowserLinkChallengeId(typeof window === 'undefined' ? undefined : window)
    : null
  const hostAuthProvider: HostAuthProvider | null = hostBridge.kind === 'max' || hostBridge.kind === 'telegram'
    ? hostBridge.kind
    : null
  const initData = hostBridge.rawAuthData()
  const { authAttemptKey, hostAuthError, hasStartedHostAuth, isHostAuthPending, resetHostAuth, startedHostAuthKey } = useHostAuthHandoff({
    auth,
    initData,
    isHostAvailable: hostBridge.isAvailable,
    forceAuth: Boolean(maxBrowserChallengeId),
    provider: hostAuthProvider,
  })
  const hostAuthState = useMemo(() => auth && hostAuthProvider ? {
    provider: hostAuthProvider,
    hasStartedAuth: startedHostAuthKey === authAttemptKey,
    hasPreviousAuthAttempt: hasStartedHostAuth,
    hasInitData: Boolean(initData),
    isAuthenticated: auth.isAuthenticated,
    isAuthBootstrapping: auth.isBootstrapping,
    isAuthPending: isHostAuthPending,
    isHostAvailable: hostBridge.isAvailable,
    forceAuth: Boolean(maxBrowserChallengeId),
  } : null, [auth, authAttemptKey, hasStartedHostAuth, hostAuthProvider, initData, isHostAuthPending, maxBrowserChallengeId, startedHostAuthKey, hostBridge.isAvailable])

  const insets = hostBridge.getInsets()
  useEffect(() => {
    // Sheets and dialogs portal to document.body, outside the page wrapper.
    const root = document.documentElement
    const values = {
      '--host-inset-top': `${insets.top}px`,
      '--host-inset-right': `${insets.right}px`,
      '--host-inset-bottom': `${insets.bottom}px`,
      '--host-inset-left': `${insets.left}px`,
    }
    const previous = Object.keys(values).map((name) => [name, root.style.getPropertyValue(name)] as const)
    for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value)
    return () => {
      for (const [name, value] of previous) {
        if (value) root.style.setProperty(name, value)
        else root.style.removeProperty(name)
      }
    }
  }, [insets.top, insets.right, insets.bottom, insets.left])

  if (!hostBridge.isAvailable) return <OpenInTelegram />

  const style = {
    '--host-inset-bottom': `${insets.bottom}px`,
    '--host-inset-left': `${insets.left}px`,
    '--host-inset-right': `${insets.right}px`,
    '--host-inset-top': `${insets.top}px`,
  } as CSSProperties
  if (!auth || auth.isBootstrapping || (hostAuthState && shouldKeepHostAuthPreloader(hostAuthState))) return <BootPreloader style={style} />
  if (!auth.user) {
    if (hostBridge.kind === 'browser') {
      if (auth.sessionError) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}><BrandLogo className="w-[148px]" /><div className="mt-8"><InlineError onRetry={() => void auth.retrySession()} /></div></main>
      return <BrowserLinkLogin style={style} />
    }
    return (
      <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
        <BrandLogo className="w-[148px]" />
        <div className="mt-8"><InlineError onRetry={() => {
          resetHostAuth()
          void auth.retrySession()
        }} /></div>
        {hostAuthError ? <Typography className="mt-3" tone="muted" variant="memoryMeta">Проверьте соединение и повторите попытку.</Typography> : null}
      </main>
    )
  }
  if (hostBridge.kind === 'browser' && (auth.externalIdentityProvider !== 'max' || auth.sessionError)) {
    return <BrowserLinkLogin style={style} />
  }
  if (hostBridge.kind === 'max' && maxBrowserChallengeId && initData && hostAuthError) {
    return <MaxBrowserLinkAuthFailure onRetry={resetHostAuth} style={style} />
  }
  if (hostBridge.kind === 'max' && maxBrowserChallengeId && initData) {
    return <MaxBrowserLinkApproval challengeId={maxBrowserChallengeId} initData={initData} style={style} />
  }
  if (typeof window !== 'undefined' && shouldShowMaxRuntimeDiagnostic(hostBridge.kind, window)) {
    return <MaxRuntimeDiagnosticPanel diagnostic={readMaxRuntimeDiagnostic(window)} style={style} />
  }
  const maxVideoUploadAcceptance = hostBridge.kind === 'max'
    && isMaxVideoUploadAcceptanceLaunch(typeof window === 'undefined' ? undefined : window)
  return <FamilyController currentUserId={auth.user.id} hostBridge={hostBridge} insets={insets} insetsStyle={style} inviteToken={hostBridge.inviteToken()} maxVideoUploadAcceptance={maxVideoUploadAcceptance} transport={auth.transport} />
}

function MaxRuntimeDiagnosticPanel({ diagnostic, style }: { diagnostic: MaxRuntimeDiagnostic; style: CSSProperties }) {
  const rows: Array<[string, string]> = [
    ['hostDetected', yesNo(diagnostic.hostDetected)],
    ['window.WebApp present', yesNo(diagnostic.webAppPresent)],
    ['initData present', yesNo(diagnostic.initDataPresent)],
    ['signed start_param present', yesNo(diagnostic.signedStartParamPresent)],
    ['signed start_param value', diagnostic.signedStartParamValue ?? '—'],
    ['initDataUnsafe present', yesNo(diagnostic.initDataUnsafePresent)],
    ['initDataUnsafe.start_param present', yesNo(diagnostic.unsafeStartParamPresent)],
    ['initDataUnsafe.start_param value', diagnostic.unsafeStartParamValue ?? '—'],
    ['WebAppStartParam present', yesNo(diagnostic.webAppStartParamPresent)],
    ['WebAppStartParam value', diagnostic.webAppStartParamValue ?? '—'],
    ['location pathname', diagnostic.locationPathname || '—'],
    ['location query key names', diagnostic.locationQueryKeys.length > 0 ? diagnostic.locationQueryKeys.join(', ') : '—'],
    ['resolved start param', diagnostic.resolvedStartParam ?? '—'],
    ['isMaxVideoUploadAcceptanceLaunch', yesNo(diagnostic.isMaxVideoUploadAcceptanceLaunch)],
  ]

  return <main aria-labelledby="max-runtime-diagnostic-title" className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
    <Typography as="h1" id="max-runtime-diagnostic-title" variant="memoryScreen">MAX runtime diagnostic</Typography>
    <Typography className="mt-3" tone="muted" variant="memoryBody">Безопасный снимок параметров запуска. Секретные данные не отображаются.</Typography>
    <dl className="mt-6 grid gap-3 rounded-[var(--radius-card)] bg-card p-5 shadow-[var(--shadow-card)]">
      {rows.map(([label, value]) => <div className="grid gap-1" key={label}><Typography as="dt" variant="memoryMeta">{label}</Typography><Typography as="dd" className="break-words" tone="muted" variant="memoryMeta">{value}</Typography></div>)}
    </dl>
  </main>
}

function yesNo(value: boolean) {
  return value ? 'yes' : 'no'
}

function FamilyController({ currentUserId, hostBridge, insets, insetsStyle, inviteToken, maxVideoUploadAcceptance, transport }: { currentUserId: string; hostBridge: HostBridge; insets: TelegramInsets; insetsStyle: CSSProperties; inviteToken: string | null; maxVideoUploadAcceptance: boolean; transport: AuthenticatedTransport }) {
  const [familyResponse, setFamilyResponse] = useState<FamilyResponse | null>(null)
  const [members, setMembers] = useState<FamilyMemberDto[]>([])
  const [invites, setInvites] = useState<FamilyInviteDto[]>([])
  const [error, setError] = useState<Error | null>(null)
  const [editingChild, setEditingChild] = useState(false)
  const [editingChildPhoto, setEditingChildPhoto] = useState(false)
  const [viewingChild, setViewingChild] = useState(false)
  const [screen, setScreen] = useState<'family' | 'feed'>('family')
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [invitePreview, setInvitePreview] = useState<InvitePreviewResponse | null>(null)
  const [inviteIssue, setInviteIssue] = useState<string | null>(null)
  const [inviteHandled, setInviteHandled] = useState(false)
  const [noFamily, setNoFamily] = useState(false)
  const [accessLost, setAccessLost] = useState(false)
  const [isFamilyBootstrapping, setIsFamilyBootstrapping] = useState(true)
  const autoAcceptingInvite = useRef(false)

  const refresh = useCallback(async ({ bootstrap = false, failureMode = 'global' }: { bootstrap?: boolean; failureMode?: 'global' | 'throw' } = {}) => {
    if (bootstrap) setIsFamilyBootstrapping(true)
    setError(null)
    setInviteIssue(null)
    setNoFamily(false)
    try {
      let me = await loadFamilyMe(transport)
      if (inviteToken && !inviteHandled) {
        try {
          const preview = await previewInvite(transport, inviteToken)
          if (me.activeFamily && me.activeFamily.id !== preview.family.id) {
            setInviteIssue('OTHER_FAMILY')
            setFamilyResponse(null)
            return
          }
          if (!me.activeFamily) {
            if (hostBridge.kind === 'browser') {
              if (!autoAcceptingInvite.current) {
                autoAcceptingInvite.current = true
                try {
                  await acceptInvite(transport, inviteToken)
                } finally {
                  autoAcceptingInvite.current = false
                }
              }
              setInviteHandled(true)
              me = await loadFamilyMe(transport)
            } else {
              setInvitePreview(preview)
              setFamilyResponse(null)
              return
            }
          }
          if (!me.activeFamily) {
            setInvitePreview(preview)
            setFamilyResponse(null)
            return
          }
          setInviteHandled(true)
        } catch (reason) {
          if (failureMode === 'throw') throw reason
          setInviteIssue(inviteIssueCode(reason))
          setFamilyResponse(null)
          return
        }
      }
      const activeFamily = me.activeFamily
      if (!activeFamily) {
        setFamilyResponse(null)
        setNoFamily(true)
        return
      }
      const response = await loadFamily(transport, activeFamily.id)
      setFamilyResponse(response)
      if (response.child) {
        const [nextMembers, nextInvites] = await Promise.all([
          loadFamilyMembers(transport, response.family.id),
          loadFamilyInvites(transport, response.family.id).catch((reason) => {
            if (failureMode === 'throw') throw reason
            return { items: [] }
          }),
        ])
        setMembers(nextMembers.items)
        setInvites(nextInvites.items)
      }
      if (bootstrap) {
        const startRoute = decideStartupRoute({
          status: 'ready', hasActiveFamily: true, hasChildProfile: Boolean(response.child),
        })
        if (startRoute !== 'boot') setScreen(startRoute)
      }
    } catch (reason) {
      if (failureMode === 'throw') throw reason
      setError(reason instanceof Error ? reason : new Error('Не удалось загрузить семью.'))
    } finally {
      if (bootstrap) setIsFamilyBootstrapping(false)
    }
  }, [hostBridge.kind, inviteHandled, inviteToken, transport])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh({ bootstrap: true }) }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  if (isFamilyBootstrapping) return <BootPreloader style={insetsStyle} />
  if (error) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={insetsStyle}><InlineError onRetry={() => void refresh()} /></main>
  if (inviteIssue) return <IncomingInviteIssue code={inviteIssue} onRetry={refresh} style={insetsStyle} />
  if (invitePreview && inviteToken && !inviteHandled) return <IncomingInvite preview={invitePreview} style={insetsStyle} onAccept={async () => {
    try {
      await acceptInvite(transport, inviteToken)
      setInviteHandled(true)
      setInvitePreview(null)
    } catch (reason) {
      setInviteIssue(inviteIssueCode(reason))
      setInvitePreview(null)
    }
  }} />
  if (noFamily) return <NoFamily style={insetsStyle} onCreate={async () => {
    await createFamilyBootstrap(transport, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    await refresh({ bootstrap: true })
  }} />
  if (accessLost) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={insetsStyle}><Typography variant="memoryScreen">Доступ закрыт</Typography><Typography className="mt-8" tone="muted" variant="memoryBody">Доступ к семейной ленте закрыт.</Typography></main>
  if (!familyResponse) return <BootPreloader style={insetsStyle} />
  if (!familyResponse.child || editingChild) return <div style={insetsStyle}><FamilyOnboarding familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} initialChild={familyResponse.child ?? undefined} photoOnly={editingChildPhoto} onCancel={familyResponse.child ? () => { setEditingChild(false); setEditingChildPhoto(false) } : undefined} onCompleted={async () => { await refresh({ bootstrap: !familyResponse.child }); if (!editingChildPhoto) setEditingChild(false); if (!editingChildPhoto) setEditingChildPhoto(false) }} transport={transport} /></div>
  const current = members.find((member) => member.userId === currentUserId)
  if (screen === 'feed') {
    return <div style={insetsStyle}><FeedPage childAvatarCrop={familyResponse.child.avatarCrop} childAvatarMediaId={familyResponse.child.avatarMediaId} childId={familyResponse.child.id} childName={familyResponse.child.name} childSubtitle={feedChildSubtitle(familyResponse.child.birthDate, familyResponse.family.timezone)} familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} filter={filter} hostBridge={hostBridge} insets={insets} isAppBootstrapped maxVideoUploadAcceptance={maxVideoUploadAcceptance} onAccessLost={() => setAccessLost(true)} onFamily={() => setScreen('family')} onFilterChange={setFilter} role={current?.role === 'full' ? 'full' : 'viewer'} transport={transport} /></div>
  }
  return <div style={insetsStyle}><FamilyScreen childProfileOpen={viewingChild} createInviteLink={hostBridge.inviteLink} currentUserId={currentUserId} familyResponse={familyResponse} hostBridge={hostBridge} invites={invites} members={members} onCloseChild={() => setViewingChild(false)} onEditChild={() => { setEditingChildPhoto(false); setEditingChild(true) }} onChangeChildPhoto={() => { setEditingChildPhoto(true); setEditingChild(true) }} onFeed={() => { setViewingChild(false); setScreen('feed') }} onOpenChild={() => setViewingChild(true)} onRefresh={refresh} transport={transport} /></div>
}

function NoFamily({ style, onCreate }: { style: CSSProperties; onCreate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}><BrandLogo className="w-[148px]" /><Typography className="mt-8" tone="muted" variant="memoryBody">Создайте семейную ленту, чтобы добавить профиль ребёнка.</Typography><Button className="mt-6" disabled={busy} onClick={() => void (async () => { setBusy(true); setCreateError(null); try { await onCreate() } catch (error) { setCreateError(createFamilyErrorMessage(error)) } finally { setBusy(false) } })()} type="button"><Typography variant="memoryButton">Создать семью</Typography></Button>{createError ? <Typography className="mt-3 text-destructive" role="alert" variant="memoryMeta">{createError}</Typography> : null}</main>
}

function BrowserLinkLogin({ style }: { style: CSSProperties }) {
  const auth = useContext(AuthContext)
  const [challenge, setChallenge] = useState<BrowserLinkStartResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [status, setStatus] = useState<'pending' | 'approved' | 'expired'>('pending')
  const didStart = useRef(false)

  const start = useCallback(async () => {
    if (!auth) return
    setIsStarting(true)
    setError(null)
    setChallenge(null)
    setStatus('pending')
    try {
      const next = await auth.startBrowserLink()
      setChallenge(next)
    } catch {
      setError('Не удалось создать запрос входа. Проверьте соединение и повторите.')
    } finally {
      setIsStarting(false)
    }
  }, [auth])

  useEffect(() => {
    if (didStart.current) return
    didStart.current = true
    void start()
  }, [start])

  useEffect(() => {
    if (!auth || !challenge) return
    let stopped = false
    let redeeming = false
    const poll = async () => {
      try {
        const next = await auth.browserLinkStatus(challenge.challengeId)
        if (stopped) return
        setStatus(next.status)
        if (next.status === 'expired' || next.status !== 'approved' || redeeming) return
        redeeming = true
        setIsRedeeming(true)
        setError(null)
        try {
          await auth.redeemBrowserLink(challenge.challengeId)
        } catch {
          if (!stopped) setError('Не удалось завершить вход. Запрос истёк, создайте новый.')
        } finally {
          redeeming = false
          if (!stopped) setIsRedeeming(false)
        }
      } catch {
        if (!stopped) setError('Не удалось проверить подтверждение. Проверьте соединение.')
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1500)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [auth, challenge])

  const maxLink = challenge
    ? createMaxBrowserLink(challenge.startParam, import.meta.env.VITE_MAX_BOT_USERNAME)
    : null
  const expired = status === 'expired'

  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
    <BrandLogo className="w-[148px]" />
    <section className="mx-auto mt-12 max-w-md rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]">
      <Typography variant="memoryScreen">Вход через MAX</Typography>
      <Typography className="mt-4" tone="muted" variant="memoryBody">Откройте MAX, подтвердите этот код и вернитесь сюда. После подтверждения вход сохранится в браузере.</Typography>
      {challenge && !expired ? <>
        <Typography align="center" className="mt-8" style={{ letterSpacing: '0.35em' }} variant="h1">{challenge.displayCode}</Typography>
        {maxLink ? <Button asChild className="mt-8 min-h-12 w-full"><a href={maxLink} rel="noreferrer" target="_blank"><Typography variant="memoryButton">Открыть MAX</Typography></a></Button> : <Typography className="mt-6 text-destructive" role="alert" variant="memoryMeta">Не настроена ссылка на MAX-бота.</Typography>}
        <Typography className="mt-4 text-center" tone="muted" variant="memoryMeta">{isRedeeming ? 'Завершаем вход…' : 'Ожидаем подтверждение…'}</Typography>
      </> : null}
      {expired ? <Typography className="mt-6 text-destructive" role="alert" variant="memoryBody">Запрос истёк.</Typography> : null}
      {error ? <Typography className="mt-6 text-destructive" role="alert" variant="memoryMeta">{error}</Typography> : null}
      {(expired || error) ? <Button className="mt-6 min-h-12 w-full" disabled={isStarting} onClick={() => void start()} type="button"><Typography variant="memoryButton">Создать новый код</Typography></Button> : null}
      {isStarting ? <Typography className="mt-6 text-center" tone="muted" variant="memoryMeta">Создаём код…</Typography> : null}
    </section>
  </main>
}

function MaxBrowserLinkAuthFailure({ onRetry, style }: { onRetry: () => void; style: CSSProperties }) {
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
    <BrandLogo className="w-[148px]" />
    <section className="mx-auto mt-12 max-w-md rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]">
      <Typography variant="memoryScreen">Не удалось подтвердить MAX</Typography>
      <Typography className="mt-4" tone="muted" variant="memoryBody">Откройте ссылку из браузера ещё раз, чтобы получить новый код.</Typography>
      <Button className="mt-8 min-h-12 w-full" onClick={onRetry} type="button"><Typography variant="memoryButton">Повторить</Typography></Button>
    </section>
  </main>
}

function MaxBrowserLinkApproval({ challengeId, initData, style }: { challengeId: string; initData: string; style: CSSProperties }) {
  const auth = useContext(AuthContext)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const displayCode = challengeId.slice(0, 6)

  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
    <BrandLogo className="w-[148px]" />
    <section className="mx-auto mt-12 max-w-md rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]">
      <Typography variant="memoryScreen">Подтвердить вход</Typography>
      {approved ? <Typography className="mt-5" variant="memoryBody">Вход в браузере подтверждён. Можно вернуться в браузер и закрыть это окно.</Typography> : <>
        <Typography className="mt-4" tone="muted" variant="memoryBody">Подтверждайте только если вы сами начали вход в браузере и этот код совпадает с кодом на экране браузера:</Typography>
        <Typography align="center" className="mt-8" style={{ letterSpacing: '0.35em' }} variant="h1">{displayCode}</Typography>
        {error ? <Typography className="mt-6 text-destructive" role="alert" variant="memoryMeta">{error}</Typography> : null}
        <Button className="mt-8 min-h-12 w-full" disabled={busy || !auth} onClick={() => void (async () => {
          if (!auth) return
          setBusy(true)
          setError(null)
          try {
            await auth.approveBrowserLink(challengeId, initData)
            setApproved(true)
          } catch {
            setError('Не удалось подтвердить вход. Код мог истечь, создайте новый из браузера.')
          } finally {
            setBusy(false)
          }
        })()} type="button"><Typography variant="memoryButton">Подтвердить вход</Typography></Button>
      </>}
    </section>
  </main>
}

function OpenInTelegram() {
  return (
    <main className="mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col px-7 py-10">
      <BrandLogo className="w-[180px]" />
      <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
        <span className="flex size-18 items-center justify-center rounded-full bg-accent"><WebpIcon decorative name="info" size={32} state="active" /></span>
        <Typography className="mt-7 max-w-80" variant="memoryDialog">Откройте приложение в Telegram</Typography>
        <Typography className="mt-4 max-w-84" tone="muted" variant="memoryBody">В этой тестовой версии вход работает через нашего бота.</Typography>
        <Button aria-label="Открыть бота" asChild className="mt-7 min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]"><a href="https://t.me/OurMemoriesDevBot"><Typography variant="memoryButton">Открыть бота</Typography></a></Button>
      </div>
    </main>
  )
}
