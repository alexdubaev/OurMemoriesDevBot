import type { CSSProperties } from 'react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserLinkStartResponse, FamilyHomeResponse, FamilyInviteDto, FamilyMemberDto, FamilyResponse, InvitePreviewResponse } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { FeedPage, InlineError, SeenBatchQueue, type FeedFilter } from '@/features/feed'
import { AuthContext, shouldKeepHostAuthPreloader, useHostAuthHandoff, type HostAuthProvider } from '@/features/auth'
import { BootPreloader } from '@/features/app'
import {
  acceptInvite,
  createFamilyBootstrap,
  canStartMaxVideoUpload,
  createFamilyErrorMessage,
  feedChildSubtitle,
  FamilyOnboarding,
  FamilyHubPage,
  FamilyScreen,
  loadFamily,
  loadFamilyInvites,
  loadFamilyHome,
  loadFamilyMembers,
  inviteIssueCode,
  IncomingInvite,
  IncomingInviteIssue,
  previewInvite,
} from '@/features/family'
import type { HostBridge } from '@/platform/telegram'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { isMaxVideoUploadAcceptanceLaunch, readMaxRuntimeDiagnostic, shouldShowMaxRuntimeDiagnostic, type MaxRuntimeDiagnostic } from '@/platform/max/host-bridge'
import { createMaxBrowserLink, maxBrowserLinkChallengeId } from '@/platform/max/host-bridge'
import { ThemeProvider } from '@/features/theme'
import { claimWelcome, WelcomeSplash } from '@/features/welcome'

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
  return <FamilyController key={auth.user.id} currentUserId={auth.user.id} hostBridge={hostBridge} insets={insets} insetsStyle={style} inviteToken={hostBridge.inviteToken()} maxVideoUploadAcceptance={maxVideoUploadAcceptance} transport={auth.transport} />
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
  const [home, setHome] = useState<FamilyHomeResponse | null>(null)
  const homeRef = useRef<FamilyHomeResponse | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [familyResponse, setFamilyResponse] = useState<FamilyResponse | null>(null)
  const [members, setMembers] = useState<FamilyMemberDto[]>([])
  const [invites, setInvites] = useState<FamilyInviteDto[]>([])
  const [editingChild, setEditingChild] = useState(false)
  const [editingChildPhoto, setEditingChildPhoto] = useState(false)
  const [viewingChild, setViewingChild] = useState(false)
  const [screen, setScreen] = useState<'hub' | 'family' | 'feed'>('hub')
  const [openAddFromFamily, setOpenAddFromFamily] = useState(false)
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [selectedMembershipEpoch, setSelectedMembershipEpoch] = useState<number | null>(null)
  const [invitePreview, setInvitePreview] = useState<InvitePreviewResponse | null>(null)
  const [inviteIssue, setInviteIssue] = useState<string | null>(null)
  const [invitePending, setInvitePending] = useState(Boolean(inviteToken))
  const [maxVideoPending, setMaxVideoPending] = useState(maxVideoUploadAcceptance)
  const maxVideoPendingRef = useRef(maxVideoUploadAcceptance)
  const selectionVersion = useRef(0)
  const selectedFamilyIdRef = useRef<string | null>(null)
  const homeRefreshVersion = useRef(0)
  const homeRefreshInFlight = useRef<Promise<FamilyHomeResponse> | null>(null)
  const createKey = useRef<string | null>(null)
  const autoAcceptingInvite = useRef<Promise<unknown> | null>(null)
  const seenQueueRef = useRef<SeenBatchQueue | null>(null)
  const [welcomeVisible, setWelcomeVisible] = useState(false)
  const [welcomeGateComplete, setWelcomeGateComplete] = useState(false)
  const welcomeSeen = useRef(false)
  const welcomeResolve = useRef<(() => void) | null>(null)
  const welcomeClaim = useRef<ReturnType<typeof claimWelcome> | null>(null)
  const [welcomeClaimError, setWelcomeClaimError] = useState(false)
  const [welcomeClaimRetry, setWelcomeClaimRetry] = useState(0)

  const finishWelcome = useCallback(() => {
    if (!welcomeResolve.current) return
    welcomeSeen.current = true
    setWelcomeVisible(false)
    setWelcomeGateComplete(true)
    const resolve = welcomeResolve.current
    welcomeResolve.current = null
    resolve()
  }, [])

  const refreshHome = useCallback(async (initial = false) => {
    const version = ++homeRefreshVersion.current
    if (initial) setHomeLoading(true)
    setHomeError(null)
    try {
      if (homeRefreshInFlight.current) await homeRefreshInFlight.current.catch(() => undefined)
      if (version !== homeRefreshVersion.current) return null
      const request = (async () => {
        let result = await loadFamilyHome(transport)
        const priorCount = homeRef.current?.items.length ?? 0
        const selectedId = selectedFamilyIdRef.current
        while (result.nextCursor && (result.items.length < priorCount || (selectedId && !result.items.some((item) => item.familyId === selectedId)))) {
          const next = await loadFamilyHome(transport, result.nextCursor)
          result = { ...next, items: [...result.items, ...next.items] }
        }
        return result
      })()
      homeRefreshInFlight.current = request
      let result: FamilyHomeResponse
      try { result = await request }
      finally { if (homeRefreshInFlight.current === request) homeRefreshInFlight.current = null }
      if (version !== homeRefreshVersion.current) return null
      homeRef.current = result
      setHome(result)
      return result
    } catch {
      if (version !== homeRefreshVersion.current) return null
      if (homeRef.current) {
        const stale = { ...homeRef.current, items: homeRef.current.items.map((item) => item.unreadState === 'ready'
          ? { ...item, unreadCount: null, unreadState: 'unavailable' as const } : item) }
        homeRef.current = stale
        setHome(stale)
        setNotice('Не удалось обновить список семей. Счётчики временно недоступны.')
      }
      else setHomeError('Проверьте соединение и повторите попытку.')
      return null
    } finally {
      if (version === homeRefreshVersion.current) setHomeLoading(false)
    }
  }, [transport])

  useEffect(() => {
    const queue = new SeenBatchQueue(currentUserId, transport,
      () => { void refreshHome() },
      () => { void refreshHome() })
    seenQueueRef.current = queue
    return () => {
      queue.dispose()
      if (seenQueueRef.current === queue) seenQueueRef.current = null
    }
  }, [currentUserId, refreshHome, transport])

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== 'visible') return
      seenQueueRef.current?.resume()
      if ((screen === 'hub' || selectedFamilyIdRef.current) && !homeRefreshInFlight.current) void refreshHome()
    }
    const poll = window.setInterval(() => {
      if ((screen === 'hub' || selectedFamilyIdRef.current) && document.visibilityState === 'visible' && !homeRefreshInFlight.current) void refreshHome()
    }, 30_000)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => { window.clearInterval(poll); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume) }
  }, [refreshHome, screen])

  const selectFamily = useCallback(async (familyId: string) => {
    const version = ++selectionVersion.current
    setBusy(true)
    setNotice(null)
    setFamilyResponse(null)
    setMembers([])
    setInvites([])
    setFilter('all')
    setOpenAddFromFamily(false)
    setViewingChild(false)
    try {
      const response = await loadFamily(transport, familyId)
      if (version !== selectionVersion.current) return
      let summary = homeRef.current?.items.find((item) => item.familyId === familyId)
      if (!summary) {
        let page = await loadFamilyHome(transport)
        summary = page.items.find((item) => item.familyId === familyId)
        while (!summary && page.nextCursor) {
          page = await loadFamilyHome(transport, page.nextCursor)
          summary = page.items.find((item) => item.familyId === familyId)
        }
      }
      if (version !== selectionVersion.current) return
      if (!summary) throw new ApiRequestError(404, 'NOT_FOUND', 'Семья не найдена')
      if (homeRef.current && !homeRef.current.items.some((item) => item.familyId === familyId)) {
        const updated = { ...homeRef.current, items: [...homeRef.current.items, summary] }
        homeRef.current = updated
        setHome(updated)
      }
      const [nextMembers, nextInvites] = response.child
        ? await Promise.all([
          loadFamilyMembers(transport, familyId),
          loadFamilyInvites(transport, familyId).catch(() => ({ items: [] as FamilyInviteDto[] })),
        ])
        : [{ items: [] as FamilyMemberDto[] }, { items: [] as FamilyInviteDto[] }]
      if (version !== selectionVersion.current) return
      if (maxVideoPendingRef.current && !canStartMaxVideoUpload(
        homeRef.current?.items.find((item) => item.familyId === familyId),
        nextMembers.items.find((member) => member.userId === currentUserId),
        Boolean(response.child),
      )) {
        setNotice('Для этой семьи загрузка видео недоступна. Выберите другую семью.')
        setScreen('hub')
        return
      }
      setFamilyResponse(response)
      selectedFamilyIdRef.current = familyId
      setSelectedMembershipEpoch(summary.membershipEpoch)
      setMembers(nextMembers.items)
      setInvites(nextInvites.items)
      setScreen(response.child ? 'feed' : 'family')
    } catch (reason) {
      if (version !== selectionVersion.current) return
      setNotice(reason instanceof ApiRequestError && [403, 404].includes(reason.status)
        ? 'Доступ к этой семье закрыт.'
        : 'Не удалось открыть семью. Повторите попытку.')
      setScreen('hub')
      void refreshHome()
    } finally {
      if (version === selectionVersion.current) setBusy(false)
    }
  }, [currentUserId, refreshHome, transport])

  const returnHome = useCallback((message?: string) => {
    selectionVersion.current += 1
    selectedFamilyIdRef.current = null
    setSelectedMembershipEpoch(null)
    setFamilyResponse(null)
    setMembers([])
    setInvites([])
    setScreen('hub')
    setEditingChild(false)
    setEditingChildPhoto(false)
    setViewingChild(false)
    setOpenAddFromFamily(false)
    setFilter('all')
    setBusy(false)
    setNotice(message ?? null)
    void refreshHome()
  }, [refreshHome])

  useEffect(() => {
    const familyId = selectedFamilyIdRef.current
    if (!familyId || !home || selectedMembershipEpoch === null) return
    const item = home.items.find((entry) => entry.familyId === familyId)
    if (item && item.membershipEpoch === selectedMembershipEpoch) return
    seenQueueRef.current?.cancelFamily(familyId)
    returnHome('Доступ к этой семье изменился. Выберите её снова в списке.')
  }, [home, returnHome, selectedMembershipEpoch])

  const refreshSelected = useCallback(async () => {
    const familyId = familyResponse?.family.id
    if (!familyId) return
    const version = selectionVersion.current
    try {
      const response = await loadFamily(transport, familyId)
      if (version !== selectionVersion.current) return
      setFamilyResponse(response)
      if (response.child) {
        const [nextMembers, nextInvites] = await Promise.all([
          loadFamilyMembers(transport, familyId),
          loadFamilyInvites(transport, familyId).catch(() => ({ items: [] as FamilyInviteDto[] })),
        ])
        if (version !== selectionVersion.current) return
        setMembers(nextMembers.items)
        setInvites(nextInvites.items)
      }
    } catch (reason) {
      if (version !== selectionVersion.current) return
      if (reason instanceof ApiRequestError && [403, 404].includes(reason.status)) returnHome('Доступ к этой семье закрыт.')
      else setNotice('Не удалось обновить семью. Повторите попытку.')
    }
  }, [familyResponse?.family.id, returnHome, transport])

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      // Keep one claim promise across React's development effect replay. A replayed
      // request would consume the server claim and hide Welcome from this mount.
      welcomeClaim.current ??= claimWelcome(transport).catch((error: unknown) => {
        welcomeClaim.current = null
        throw error
      })
      let showWelcome: boolean
      try {
        ;({ showWelcome } = await welcomeClaim.current)
      } catch {
        if (!cancelled) setWelcomeClaimError(true)
        return
      }
      if (cancelled) return
      setWelcomeClaimError(false)
      if (showWelcome && !welcomeSeen.current) {
        await new Promise<void>((resolve) => {
          welcomeResolve.current = resolve
          setWelcomeVisible(true)
        })
        if (cancelled) return
      }
      setWelcomeGateComplete(true)
      if (inviteToken) {
        try {
          const preview = await previewInvite(transport, inviteToken)
          if (cancelled) return
          const catalog = await refreshHome(true)
          if (cancelled) return
          let alreadyMember = catalog?.items.some((item) => item.familyId === preview.family.id) ?? false
          let cursor = catalog?.nextCursor ?? null
          while (!alreadyMember && cursor) {
            const next = await loadFamilyHome(transport, cursor)
            if (cancelled) return
            alreadyMember = next.items.some((item) => item.familyId === preview.family.id)
            cursor = next.nextCursor
          }
          if (alreadyMember) {
            void selectFamily(preview.family.id)
            return
          }
          if (hostBridge.kind === 'browser') {
            autoAcceptingInvite.current ??= acceptInvite(transport, inviteToken)
            try { await autoAcceptingInvite.current }
            catch (reason) { autoAcceptingInvite.current = null; throw reason }
            if (cancelled) return
            await refreshHome(true)
            if (!cancelled) void selectFamily(preview.family.id)
          } else {
            setInvitePreview(preview)
          }
        } catch (reason) {
          if (!cancelled) setInviteIssue(inviteIssueCode(reason))
        } finally {
          if (!cancelled) { setWelcomeGateComplete(true); setInvitePending(false) }
        }
        return
      }
      const result = await refreshHome(true)
      if (cancelled) return
      if (!cancelled && maxVideoUploadAcceptance && result?.items.length === 1 && !result.nextCursor) {
        void selectFamily(result.items[0]!.familyId)
      } else if (!cancelled && maxVideoUploadAcceptance && result?.items.length) {
        setNotice('Выберите семью для загрузки видео.')
      }
    }
    void start()
    return () => {
      cancelled = true
      const resolve = welcomeResolve.current
      welcomeResolve.current = null
      resolve?.()
    }
  }, [currentUserId, hostBridge.kind, inviteToken, maxVideoUploadAcceptance, refreshHome, selectFamily, transport, welcomeClaimRetry])

  const loadMore = async () => {
    if (!home?.nextCursor || loadingMore) return
    const cursor = home.nextCursor
    const refreshVersion = homeRefreshVersion.current
    setLoadingMore(true)
    try {
      const next = await loadFamilyHome(transport, cursor)
      const current = homeRef.current
      if (refreshVersion === homeRefreshVersion.current && current?.nextCursor === cursor) {
        const merged = { ...next, items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.familyId === item.familyId))] }
        homeRef.current = merged
        setHome(merged)
      }
    } catch {
      setNotice('Не удалось загрузить остальные семьи. Повторите попытку.')
    } finally {
      setLoadingMore(false)
    }
  }

  const createOwnFamily = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    createKey.current ??= crypto.randomUUID()
    try {
      const response = await createFamilyBootstrap(transport, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', createKey.current)
      createKey.current = null
      await refreshHome()
      await selectFamily(response.family.id)
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.code === 'ALREADY_IN_FAMILY') {
        createKey.current = null
        const latest = await refreshHome(true)
        if (latest?.ownFamilyId && latest.ownFamilyStatus === 'active') {
          await selectFamily(latest.ownFamilyId)
          return
        }
        setNotice('У вас уже есть своя семья. Обновите список и откройте её.')
        return
      }
      setNotice(createFamilyErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  if (welcomeVisible) return <WelcomeSplash onComplete={finishWelcome} />
  if (welcomeClaimError) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={insetsStyle}><BrandLogo className="w-[148px]" /><div className="mt-8"><InlineError onRetry={() => { setWelcomeClaimError(false); setWelcomeClaimRetry((count) => count + 1) }} /></div></main>
  if (!welcomeGateComplete || invitePending) return <BootPreloader style={insetsStyle} />
  if (inviteIssue) return <IncomingInviteIssue code={inviteIssue} onRetry={async () => {
    setInviteIssue(null)
    setInvitePending(true)
    try { setInvitePreview(await previewInvite(transport, inviteToken ?? '')) }
    catch (reason) { setInviteIssue(inviteIssueCode(reason)) }
    finally { setInvitePending(false) }
  }} style={insetsStyle} />
  if (invitePreview && inviteToken) return <IncomingInvite preview={invitePreview} style={insetsStyle} onAccept={async () => {
    try {
      await acceptInvite(transport, inviteToken)
      const familyId = invitePreview.family.id
      setInvitePreview(null)
      await refreshHome(true)
      await selectFamily(familyId)
    } catch (reason) {
      setInviteIssue(inviteIssueCode(reason))
      setInvitePreview(null)
    }
  }} />
  if (screen === 'hub' || !familyResponse) return <div style={insetsStyle}><FamilyHubPage busy={busy} error={homeError} home={home} loading={homeLoading} loadingMore={loadingMore} notice={notice} onCreate={() => void createOwnFamily()} onLoadMore={() => void loadMore()} onRetry={() => void refreshHome(true)} onSelect={(id) => void selectFamily(id)} transport={transport} /></div>
  if (!familyResponse.child || editingChild) return <div style={insetsStyle}><FamilyOnboarding familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} initialChild={familyResponse.child ?? undefined} photoOnly={editingChildPhoto} cancelLabel={familyResponse.child ? 'Отмена' : 'Все семьи'} onCancel={familyResponse.child ? () => { setEditingChild(false); setEditingChildPhoto(false) } : () => returnHome()} onCompleted={async () => {
    await refreshSelected()
    if (!familyResponse.child) setScreen('feed')
    else if (!editingChildPhoto) { setEditingChild(false); setEditingChildPhoto(false) }
  }} transport={transport} /></div>
  const current = members.find((member) => member.userId === currentUserId)
  if (screen === 'feed') return <div style={insetsStyle}><FeedPage key={familyResponse.family.id} accountId={currentUserId} childAvatarCrop={familyResponse.child.avatarCrop} childAvatarMediaId={familyResponse.child.avatarMediaId} childId={familyResponse.child.id} childName={familyResponse.child.name} childSubtitle={feedChildSubtitle(familyResponse.child.birthDate, familyResponse.family.timezone)} familyId={familyResponse.family.id} familyName={familyResponse.family.name} familyTimezone={familyResponse.family.timezone} filter={filter} hostBridge={hostBridge} insets={insets} isAppBootstrapped maxVideoUploadAcceptance={maxVideoPending} membershipEpoch={selectedMembershipEpoch} onMaxVideoLaunchHandled={() => { maxVideoPendingRef.current = false; setMaxVideoPending(false) }} onSeenCandidate={(memoryId) => { if (selectedMembershipEpoch !== null) seenQueueRef.current?.enqueue({ accountId: currentUserId, familyId: familyResponse.family.id, membershipEpoch: selectedMembershipEpoch }, memoryId) }} openAddInitially={openAddFromFamily} onAccessLost={() => { seenQueueRef.current?.cancelFamily(familyResponse.family.id); returnHome('Доступ к этой семье закрыт.') }} onAllFamilies={() => returnHome()} onFamily={() => { setOpenAddFromFamily(false); setScreen('family') }} onFilterChange={setFilter} role={current?.role === 'full' ? 'full' : 'viewer'} transport={transport} unreadCount={home?.items.find((item) => item.familyId === familyResponse.family.id)?.unreadCount ?? null} unreadState={home?.items.find((item) => item.familyId === familyResponse.family.id)?.unreadState ?? 'unavailable'} /></div>
  return <div style={insetsStyle}><button className="family-context-back" onClick={() => returnHome()} type="button"><Typography as="span" variant="memoryMeta">‹ Все семьи</Typography></button><FamilyScreen childProfileOpen={viewingChild} createInviteLink={hostBridge.inviteLink} currentUserId={currentUserId} familyResponse={familyResponse} hostBridge={hostBridge} invites={invites} members={members} onAdd={() => { setViewingChild(false); setOpenAddFromFamily(true); setScreen('feed') }} onCloseChild={() => setViewingChild(false)} onEditChild={() => { setEditingChildPhoto(false); setEditingChild(true) }} onChangeChildPhoto={() => { setEditingChildPhoto(true); setEditingChild(true) }} onFeed={() => { setViewingChild(false); setOpenAddFromFamily(false); setScreen('feed') }} onOpenChild={() => setViewingChild(true)} onRefresh={refreshSelected} transport={transport} /></div>
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
