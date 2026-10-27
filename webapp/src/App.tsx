import type { CSSProperties } from 'react'
import { useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BrowserLinkStartResponse, FamilyHomeResponse, FamilyInviteDto, FamilyMemberDto, FamilyResponse, InvitePreviewResponse } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { BottomNavigation } from '@/components/BottomNavigation'
import { AlbumsPage, ComposerHost } from '@/features/albums'
import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { composerInitialChildIds, FeedPage, InlineError, normalizeChildFilter, SeenBatchQueue, type ChildFilter, type FeedFilter } from '@/features/feed'
import { GiftsPage } from '@/features/gifts'
import { AuthContext, shouldKeepHostAuthPreloader, useHostAuthHandoff, type HostAuthProvider } from '@/features/auth'
import { BootPreloader, useOwnerGuideReplay } from '@/features/app'
import {
  acceptInvite,
  createFamilyBootstrap,
  canStartMaxVideoUpload,
  createFamilyErrorMessage,
  feedChildSubtitle,
  familyChildren,
  FamilyOnboarding,
  FamilyHubPage,
  FamilyScreen,
  useChildAvatar,
  loadFamily,
  loadFamilyInvites,
  loadFamilyHome,
  loadFamilyMembers,
  inviteIssueCode,
  IncomingInvite,
  IncomingInviteIssue,
  previewInvite,
  FamilyGuide,
} from '@/features/family'
import type { HostBridge } from '@/platform/telegram'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'
import { useQueryClient } from '@tanstack/react-query'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { isMaxVideoUploadAcceptanceLaunch, readMaxRuntimeDiagnostic, shouldShowMaxRuntimeDiagnostic, type MaxRuntimeDiagnostic } from '@/platform/max/host-bridge'
import { createMaxBrowserLink, maxBrowserLinkChallengeId } from '@/platform/max/host-bridge'
import { ThemeProvider } from '@/features/theme'
import { claimWelcome, WelcomeSplash } from '@/features/welcome'
import { memberAvatarUpdatedEvent, MemberAvatarDirectoryProvider } from '@/features/avatar'
import { readPwaInstallIntent, setPwaInstallDismissed } from '@/platform/pwa-install'
import { readUiVersion } from '@/features/ui-version'
import { allowPrivateFamilyCache, persistentUiQueryKey, privateFamilyAccessRevokedEvent, removePrivateFamilyCache, type PersistentFamilyPresentation } from '@/platform/persistence/private-cache'
import { invalidatePrivateChildAvatar } from '@/platform/media/use-private-image-url'
import { attachControlActivity } from '@/platform/control-activity'
import { readHostLayout, sameHostLayout, subscribeHostLayoutRefresh, type HostLayoutSnapshot } from '@/platform/host-layout'

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
  const maxInviteLaunch = hostBridge.kind === 'max'
    ? hostBridge.inviteLaunch?.() ?? (() => {
      const token = hostBridge.inviteToken()
      return token ? { kind: 'valid' as const, token } : { kind: 'none' as const }
    })()
    : null
  const explicitInviteIntent = maxInviteLaunch !== null && maxInviteLaunch.kind !== 'none'
  const inviteToken = maxInviteLaunch?.kind === 'valid' ? maxInviteLaunch.token : hostBridge.kind === 'max' ? null : hostBridge.inviteToken()
  const invalidInviteIntent = maxInviteLaunch?.kind === 'invalid'
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
    forceAuth: Boolean(maxBrowserChallengeId || explicitInviteIntent),
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
    forceAuth: Boolean(maxBrowserChallengeId || explicitInviteIntent),
  } : null, [auth, authAttemptKey, explicitInviteIntent, hasStartedHostAuth, hostAuthProvider, initData, isHostAuthPending, maxBrowserChallengeId, startedHostAuthKey, hostBridge.isAvailable])

  const [hostLayout, setHostLayout] = useState<HostLayoutSnapshot>(() => readHostLayout(hostBridge))
  useEffect(() => {
    const refresh = () => {
      const next = readHostLayout(hostBridge)
      setHostLayout((current) => sameHostLayout(current, next) ? current : next)
    }
    refresh()
    return subscribeHostLayoutRefresh(window, refresh)
  }, [hostBridge])
  const { insets, platform } = hostLayout
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
    const previousPlatform = root.dataset.hostLayoutPlatform
    root.dataset.hostLayoutPlatform = platform
    return () => {
      for (const [name, value] of previous) {
        if (value) root.style.setProperty(name, value)
        else root.style.removeProperty(name)
      }
      if (previousPlatform) root.dataset.hostLayoutPlatform = previousPlatform
      else delete root.dataset.hostLayoutPlatform
    }
  }, [insets.top, insets.right, insets.bottom, insets.left, platform])

  if (!hostBridge.isAvailable) return <OpenInTelegram />

  const style = {
    '--host-inset-bottom': `${insets.bottom}px`,
    '--host-inset-left': `${insets.left}px`,
    '--host-inset-right': `${insets.right}px`,
    '--host-inset-top': `${insets.top}px`,
  } as CSSProperties
  if (!auth || auth.isBootstrapping || (hostAuthState && shouldKeepHostAuthPreloader(hostAuthState))) return <BootPreloader style={style} />
  if (auth.sessionError) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" role="alert" style={style}>
    <BrandLogo className="w-[148px]" />
    <section className="mx-auto mt-12 max-w-md rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]">
      <Typography variant="memoryScreen">Не удалось восстановить вход</Typography>
      <Typography className="mt-4" tone="muted" variant="memoryBody">Проверьте соединение и повторите попытку.</Typography>
      <Button className="mt-8 min-h-12 w-full" onClick={() => {
        if (hostAuthProvider) resetHostAuth()
        void auth.retrySession()
      }} type="button"><Typography variant="memoryButton">Повторить</Typography></Button>
    </section>
  </main>
  if (explicitInviteIntent && initData && hostAuthError) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" role="alert" style={style}>
    <BrandLogo className="w-[148px]" />
    <div className="mt-8"><InlineError onRetry={resetHostAuth} /></div>
    <Typography className="mt-3" tone="muted" variant="memoryMeta">Не удалось подтвердить вход через MAX. Повторите попытку.</Typography>
  </main>
  if (!auth.user) {
    if (hostBridge.kind === 'browser') {
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
  const inviteEntryKey = inviteToken ? `invite:${inviteToken}` : invalidInviteIntent ? 'invite:invalid' : ''
  return <FamilyController key={`${auth.user.id}:${inviteEntryKey}`} currentUserId={auth.user.id} hostBridge={hostBridge} insets={insets} insetsStyle={style} inviteIntentInvalid={invalidInviteIntent} inviteToken={inviteToken} maxVideoUploadAcceptance={maxVideoUploadAcceptance} transport={auth.transport} />
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

function FamilyController({ currentUserId, hostBridge, insets, insetsStyle, inviteIntentInvalid, inviteToken, maxVideoUploadAcceptance, transport }: { currentUserId: string; hostBridge: HostBridge; insets: TelegramInsets; insetsStyle: CSSProperties; inviteIntentInvalid: boolean | undefined; inviteToken: string | null; maxVideoUploadAcceptance: boolean; transport: AuthenticatedTransport }) {
  const ownerGuide = useOwnerGuideReplay(transport, hostBridge.kind === 'max')
  const [ownerGuideOpen, setOwnerGuideOpen] = useState(false)
  const ownerGuideRequestHandled = useRef(0)
  const queryClient = useQueryClient()
  const explicitInviteIntent = Boolean(inviteToken || inviteIntentInvalid)
  const savedPresentation = explicitInviteIntent ? undefined : queryClient.getQueryData<PersistentFamilyPresentation>(persistentUiQueryKey(currentUserId))
  const hasCachedHome = Boolean(savedPresentation?.home)
  const installIntent = useMemo(() => hostBridge.kind === 'browser' ? readPwaInstallIntent(window.location) : null, [hostBridge.kind])
  const [home, setHome] = useState<FamilyHomeResponse | null>(() => savedPresentation?.home as FamilyHomeResponse | null ?? null)
  const [homeAccessConfirmed, setHomeAccessConfirmed] = useState(false)
  const homeRef = useRef<FamilyHomeResponse | null>(home)
  const [homeLoading, setHomeLoading] = useState(!hasCachedHome)
  const [homeError, setHomeError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [familyResponse, setFamilyResponse] = useState<FamilyResponse | null>(() => savedPresentation?.family as FamilyResponse | null ?? null)
  const familyResponseRef = useRef(familyResponse)
  useEffect(() => { familyResponseRef.current = familyResponse }, [familyResponse])
  const [members, setMembers] = useState<FamilyMemberDto[]>(() => savedPresentation?.members as FamilyMemberDto[] ?? [])
  const [invites, setInvites] = useState<FamilyInviteDto[]>([])
  const [childEditor, setChildEditor] = useState<{ kind: 'add' } | { kind: 'edit'; childId: string } | null>(null)
  const [familySettingsRequest, setFamilySettingsRequest] = useState(0)
  const [screen, setScreen] = useState<'hub' | 'family' | 'feed' | 'albums' | 'gifts'>(() => savedPresentation?.screen ?? 'hub')
  useEffect(() => attachControlActivity({
    transport, hostBridge, userId: currentUserId,
    familyId: homeAccessConfirmed ? familyResponse?.family.id ?? null : null,
  }), [currentUserId, familyResponse?.family.id, homeAccessConfirmed, hostBridge, screen, transport])
  const [visitedSurfaces, setVisitedSurfaces] = useState<Set<'family' | 'feed' | 'albums' | 'gifts'>>(() => new Set(
    savedPresentation?.screen === 'feed' ? ['feed'] : savedPresentation?.screen === 'family' ? ['family'] : savedPresentation?.screen === 'gifts' ? ['gifts'] : [],
  ))
  const surfaceScroll = useRef({ feed: 0, family: 0, albums: 0, gifts: 0 })
  const [globalComposerScope, setGlobalComposerScope] = useState<string | null>(null)
  const switchSurface = useCallback((next: 'family' | 'feed' | 'albums' | 'gifts') => {
    if (screen === 'feed' || screen === 'family' || screen === 'albums' || screen === 'gifts') surfaceScroll.current[screen] = window.scrollY
    setVisitedSurfaces((current) => new Set([...current, next]))
    setScreen(next)
  }, [screen])
  useLayoutEffect(() => {
    if (screen === 'feed' || screen === 'family' || screen === 'albums' || screen === 'gifts') window.scrollTo(0, surfaceScroll.current[screen])
  }, [screen, familyResponse?.family.id])
  const [openAddFromFamily, setOpenAddFromFamily] = useState(false)
  const [filter, setFilter] = useState<FeedFilter>(() => savedPresentation?.filter ?? 'all')
  // Feed child filter (v2, two or more children); the restored value was already checked against the saved family.
  const [childFilter, setChildFilter] = useState<ChildFilter>(() => savedPresentation?.childFilter ?? null)
  const [albumOpenRequest, setAlbumOpenRequest] = useState<{ albumId: string; nonce: number } | null>(null)
  const [selectedMembershipEpoch, setSelectedMembershipEpoch] = useState<number | null>(() => savedPresentation?.membershipEpoch ?? null)
  const [confirmedAvatarScope, setConfirmedAvatarScope] = useState<{ familyId: string; membershipEpoch: number } | null>(null)
  const avatarChild = familyResponse?.child
  const avatarFamilyId = familyResponse?.family.id ?? ''
  const avatarScopeConfirmed = Boolean(avatarChild && selectedMembershipEpoch !== null && home?.items.some((item) => item.familyId === avatarFamilyId && item.membershipEpoch === selectedMembershipEpoch) && confirmedAvatarScope?.familyId === avatarFamilyId && confirmedAvatarScope.membershipEpoch === selectedMembershipEpoch)
  const childAvatar = useChildAvatar(transport, avatarFamilyId, avatarChild?.avatarMediaId ?? null, {
    childId: avatarChild?.id,
    membershipEpoch: selectedMembershipEpoch,
    enabled: avatarScopeConfirmed,
  })
  const lastSelectedRole = useRef<{ familyId: string; epoch: number; role: 'full' | 'viewer' } | null>(null)
  const roleRefreshVersion = useRef(0)
  const [invitePreview, setInvitePreview] = useState<InvitePreviewResponse | null>(null)
  const [inviteIssue, setInviteIssue] = useState<string | null>(null)
  const [dismissedInviteToken, setDismissedInviteToken] = useState<string | null>(null)
  const [inviteHandled, setInviteHandled] = useState(false)
  const [invitePending, setInvitePending] = useState(explicitInviteIntent)
  const [dismissedInvalidInvite, setDismissedInvalidInvite] = useState(false)
  const [maxVideoPending, setMaxVideoPending] = useState(maxVideoUploadAcceptance)
  const maxVideoPendingRef = useRef(maxVideoUploadAcceptance)
  const selectionVersion = useRef(0)
  const selectedFamilyIdRef = useRef<string | null>(savedPresentation?.selectedFamilyId ?? null)
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

  useEffect(() => {
    if (!ownerGuide.eligible || !welcomeGateComplete || invitePending || inviteIssue || (invitePreview && inviteToken)) return
    if (ownerGuide.request !== ownerGuideRequestHandled.current) {
      ownerGuideRequestHandled.current = ownerGuide.request
      setOwnerGuideOpen(true)
    }
  }, [inviteIssue, invitePending, invitePreview, inviteToken, ownerGuide.eligible, ownerGuide.request, welcomeGateComplete])

  useEffect(() => {
    if (explicitInviteIntent && !inviteHandled) return
    const presentation: PersistentFamilyPresentation = {
      home,
      family: familyResponse,
      members,
      screen: screen === 'albums' ? 'feed' : screen,
      selectedFamilyId: selectedFamilyIdRef.current,
      membershipEpoch: selectedMembershipEpoch,
      filter,
      childFilter: normalizeChildFilter(childFilter, familyResponse ? familyChildren(familyResponse) : []),
    }
    queryClient.setQueryData(persistentUiQueryKey(currentUserId), presentation)
  }, [childFilter, currentUserId, explicitInviteIntent, familyResponse, filter, home, inviteHandled, members, queryClient, screen, selectedMembershipEpoch])

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
    if (initial && !homeRef.current) setHomeLoading(true)
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
      setHomeAccessConfirmed(true)
      const selectedFamilyId = selectedFamilyIdRef.current
      const selectedSummary = selectedFamilyId
        ? result.items.find((item) => item.familyId === selectedFamilyId)
        : undefined
      if (selectedSummary) {
        setMembers((current) => current.map((member) => member.userId === currentUserId
          ? { ...member, role: selectedSummary.role, isOwner: selectedSummary.isOwner }
          : member))
      }
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
  }, [currentUserId, transport])

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
    setConfirmedAvatarScope(null)
    setMembers([])
    setInvites([])
    setFilter('all')
    setChildFilter(null)
    setAlbumOpenRequest(null)
    setOpenAddFromFamily(false)
    selectedFamilyIdRef.current = null
    try {
      const response = await loadFamily(transport, familyId)
      if (version !== selectionVersion.current) return false
      let summary = homeRef.current?.items.find((item) => item.familyId === familyId)
      if (!summary) {
        let page = await loadFamilyHome(transport)
        summary = page.items.find((item) => item.familyId === familyId)
        while (!summary && page.nextCursor) {
          page = await loadFamilyHome(transport, page.nextCursor)
          summary = page.items.find((item) => item.familyId === familyId)
        }
      }
      if (version !== selectionVersion.current) return false
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
      if (version !== selectionVersion.current) return false
      if (maxVideoPendingRef.current && !canStartMaxVideoUpload(
        homeRef.current?.items.find((item) => item.familyId === familyId),
        nextMembers.items.find((member) => member.userId === currentUserId),
        Boolean(response.child),
      )) {
        setNotice('Для этой семьи загрузка видео недоступна. Выберите другую семью.')
        setScreen('hub')
        return false
      }
      allowPrivateFamilyCache(currentUserId, familyId, summary.membershipEpoch)
      setVisitedSurfaces(new Set(response.child ? ['feed'] : ['family']))
      surfaceScroll.current = { feed: 0, family: 0, albums: 0, gifts: 0 }
      setFamilyResponse(response)
      selectedFamilyIdRef.current = familyId
      setSelectedMembershipEpoch(summary.membershipEpoch)
      setConfirmedAvatarScope({ familyId, membershipEpoch: summary.membershipEpoch })
      setMembers(nextMembers.items)
      setInvites(nextInvites.items)
      lastSelectedRole.current = { familyId, epoch: summary.membershipEpoch, role: summary.role }
      setScreen(response.child ? 'feed' : 'family')
      return true
    } catch (reason) {
      if (version !== selectionVersion.current) return false
      const denied = reason instanceof ApiRequestError && [403, 404].includes(reason.status)
      if (denied) {
        const updated = homeRef.current && { ...homeRef.current, items: homeRef.current.items.filter((item) => item.familyId !== familyId) }
        if (updated) { homeRef.current = updated; setHome(updated) }
        void removePrivateFamilyCache(queryClient, currentUserId, familyId)
      }
      setNotice(denied
        ? 'Доступ к этой семье закрыт.'
        : 'Не удалось открыть семью. Повторите попытку.')
      setScreen('hub')
      void refreshHome()
      return false
    } finally {
      if (version === selectionVersion.current) setBusy(false)
    }
  }, [currentUserId, queryClient, refreshHome, transport])

  useEffect(() => {
    const familyId = selectedFamilyIdRef.current
    if (!familyId || selectedMembershipEpoch === null || !home) {
      lastSelectedRole.current = null
      return
    }
    const summary = home.items.find((item) => item.familyId === familyId)
    if (!summary) return
    const previous = lastSelectedRole.current
    const next = { familyId, epoch: selectedMembershipEpoch, role: summary.role }
    lastSelectedRole.current = next
    if (!previous || previous.familyId !== familyId || previous.epoch !== selectedMembershipEpoch || previous.role === summary.role) return
    const roleRefresh = ++roleRefreshVersion.current
    // Project the current role immediately, then replace stale member versions from the server.
    setMembers((current) => current.map((member) => member.userId === currentUserId
      ? { ...member, role: summary.role, isOwner: summary.isOwner }
      : member))
    const selection = selectionVersion.current
    void loadFamilyMembers(transport, familyId).then((response) => {
      if (selectedFamilyIdRef.current !== familyId || selectionVersion.current !== selection || roleRefreshVersion.current !== roleRefresh) return
      setMembers(response.items)
    }).catch(() => undefined)
  }, [currentUserId, home, selectedMembershipEpoch, transport])

  const returnHome = useCallback((message?: string, revokedFamilyId?: string) => {
    if (revokedFamilyId) {
      const updated = homeRef.current && { ...homeRef.current, items: homeRef.current.items.filter((item) => item.familyId !== revokedFamilyId) }
      if (updated) { homeRef.current = updated; setHome(updated) }
      void removePrivateFamilyCache(queryClient, currentUserId, revokedFamilyId)
    }
    selectionVersion.current += 1
    setVisitedSurfaces(new Set())
    surfaceScroll.current = { feed: 0, family: 0, albums: 0, gifts: 0 }
    selectedFamilyIdRef.current = null
    setSelectedMembershipEpoch(null)
    setConfirmedAvatarScope(null)
    lastSelectedRole.current = null
    setFamilyResponse(null)
    setMembers([])
    setInvites([])
    setScreen('hub')
    setChildEditor(null)
    setOpenAddFromFamily(false)
    setGlobalComposerScope(null)
    setFilter('all')
    setChildFilter(null)
    setAlbumOpenRequest(null)
    setBusy(false)
    setNotice(message ?? null)
    void refreshHome()
  }, [currentUserId, queryClient, refreshHome])

  useEffect(() => {
    const onFamilyAccessRevoked = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; familyId?: string }>).detail
      if (detail?.userId !== currentUserId || !detail.familyId) return
      const familyId = detail.familyId
      if (selectedFamilyIdRef.current === familyId) {
        returnHome('Доступ к этой семье закрыт.', familyId)
        return
      }
      const current = homeRef.current
      if (current) {
        const updated = { ...current, items: current.items.filter((item) => item.familyId !== familyId) }
        homeRef.current = updated
        setHome(updated)
      }
      void removePrivateFamilyCache(queryClient, currentUserId, familyId)
    }
    window.addEventListener(privateFamilyAccessRevokedEvent, onFamilyAccessRevoked)
    return () => window.removeEventListener(privateFamilyAccessRevokedEvent, onFamilyAccessRevoked)
  }, [currentUserId, queryClient, returnHome])

  const refreshSelected = useCallback(async (options?: { failureMode?: 'global' | 'throw' }) => {
    const familyId = familyResponse?.family.id
    if (!familyId || selectedFamilyIdRef.current !== familyId) return
    const version = selectionVersion.current
    const isCurrentSelection = () => selectedFamilyIdRef.current === familyId && version === selectionVersion.current
    try {
      const response = await loadFamily(transport, familyId)
      if (!isCurrentSelection()) return
      const previousChildren = familyResponseRef.current?.family.id === familyId ? familyChildren(familyResponseRef.current) : []
      const nextAvatarMediaIds = new Set(familyChildren(response).map((item) => item.avatarMediaId))
      for (const previous of previousChildren) {
        if (previous.avatarMediaId && !nextAvatarMediaIds.has(previous.avatarMediaId)) invalidatePrivateChildAvatar(currentUserId, familyId, previous.avatarMediaId)
      }
      familyResponseRef.current = response
      setFamilyResponse(response)
      const currentHome = homeRef.current
      if (currentHome?.items.some((item) => item.familyId === familyId)) {
        const updatedHome = { ...currentHome, items: currentHome.items.map((item) => item.familyId === familyId
          ? { ...item, displaySubtitle: response.child?.name ?? null, childAvatarMediaId: response.child?.avatarMediaId ?? null, childAvatarCrop: response.child?.avatarCrop ?? null }
          : item) }
        homeRef.current = updatedHome
        setHome(updatedHome)
      }
      if (selectedMembershipEpoch !== null) setConfirmedAvatarScope({ familyId, membershipEpoch: selectedMembershipEpoch })
      if (response.child) {
        const [nextMembers, nextInvites] = await Promise.all([
          loadFamilyMembers(transport, familyId),
          loadFamilyInvites(transport, familyId).catch(() => ({ items: [] as FamilyInviteDto[] })),
        ])
        if (!isCurrentSelection()) return
        setMembers(nextMembers.items)
        setInvites(nextInvites.items)
      }
    } catch (reason) {
      if (!isCurrentSelection()) return
      if (reason instanceof ApiRequestError && [403, 404].includes(reason.status)) returnHome('Доступ к этой семье закрыт.', familyId)
      else setNotice(options?.failureMode === 'throw'
        ? 'Изменения сохранены, но данные семьи не удалось обновить.'
        : 'Не удалось обновить семью. Повторите попытку.')
      if (options?.failureMode === 'throw') throw reason
    }
  }, [currentUserId, familyResponse?.family.id, returnHome, selectedMembershipEpoch, transport])

  const refreshSelectedEvent = useEffectEvent((options?: { failureMode?: 'global' | 'throw' }) => refreshSelected(options))

  // A 404 on the filtered child's feed or albums: the child was removed on another device. Reload the
  // family (a real loss of access still returns home there) and show «Все» instead of closing the family.
  const missingChildRefresh = useRef<string | null>(null)
  const handleChildFilterMissing = useCallback((childId: string) => {
    const familyId = selectedFamilyIdRef.current
    if (!familyId || missingChildRefresh.current === childId) return
    missingChildRefresh.current = childId
    const version = selectionVersion.current
    void refreshSelected().finally(() => {
      if (missingChildRefresh.current === childId) missingChildRefresh.current = null
      if (selectedFamilyIdRef.current !== familyId || version !== selectionVersion.current) return
      setChildFilter((current) => current === childId ? null : current)
    })
  }, [refreshSelected])

  useEffect(() => {
    const familyId = selectedFamilyIdRef.current
    if (!familyId || !home || selectedMembershipEpoch === null) return
    const item = home.items.find((entry) => entry.familyId === familyId)
    if (!item) {
      void refreshSelectedEvent()
      return
    }
    if (item.membershipEpoch === selectedMembershipEpoch) return
    seenQueueRef.current?.cancelFamily(familyId)
    returnHome('Доступ к этой семье изменился. Выберите её снова в списке.', familyId)
  }, [home, returnHome, selectedMembershipEpoch])

  useEffect(() => {
    const onAvatarUpdated = (event: Event) => {
      if ((event as CustomEvent<{ accountId?: string }>).detail?.accountId !== currentUserId) return
      setMembers((current) => current.map((member) => member.userId === currentUserId ? { ...member, avatarPath: null } : member))
      void refreshSelected()
    }
    window.addEventListener(memberAvatarUpdatedEvent, onAvatarUpdated)
    return () => window.removeEventListener(memberAvatarUpdatedEvent, onAvatarUpdated)
  }, [currentUserId, refreshSelected])

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
      if (inviteIntentInvalid && !dismissedInvalidInvite) {
        setInviteIssue('UNKNOWN')
        setInvitePending(false)
        return
      }
      if (inviteToken && inviteToken !== dismissedInviteToken) {
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
            if (await selectFamily(preview.family.id)) setInviteHandled(true)
            else if (!cancelled) setInviteIssue('UNKNOWN')
            return
          }
          if (hostBridge.kind === 'browser') {
            autoAcceptingInvite.current ??= acceptInvite(transport, inviteToken)
            try { await autoAcceptingInvite.current }
            catch (reason) { autoAcceptingInvite.current = null; throw reason }
            if (cancelled) return
            await refreshHome(true)
            if (!cancelled) {
              if (await selectFamily(preview.family.id)) setInviteHandled(true)
              else setInviteIssue('UNKNOWN')
            }
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
      if (selectedFamilyIdRef.current && familyResponseRef.current) {
        void refreshSelectedEvent()
        return
      }
      if (installIntent?.familyId && result) {
        let page = result
        let familyAvailable = page.items.some((item) => item.familyId === installIntent.familyId)
        while (!familyAvailable && page.nextCursor) {
          page = await loadFamilyHome(transport, page.nextCursor)
          if (cancelled) return
          familyAvailable = page.items.some((item) => item.familyId === installIntent.familyId)
        }
        if (familyAvailable) {
          void selectFamily(installIntent.familyId)
          return
        }
      }
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
  }, [currentUserId, dismissedInvalidInvite, dismissedInviteToken, hostBridge.kind, installIntent, inviteIntentInvalid, inviteToken, maxVideoUploadAcceptance, refreshHome, selectFamily, transport, welcomeClaimRetry])

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
  if (inviteIssue) return <IncomingInviteIssue code={inviteIssue} onMyFamilies={() => {
    setInviteHandled(true)
    if (inviteToken) setDismissedInviteToken(inviteToken)
    if (inviteIntentInvalid) setDismissedInvalidInvite(true)
    setInviteIssue(null)
    setInvitePreview(null)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('startapp')
      url.searchParams.delete('WebAppStartParam')
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    }
    returnHome()
  }} onRetry={async () => {
    setInviteIssue(null)
    setInvitePending(true)
    if (!inviteToken) {
      setInviteIssue('NOT_FOUND')
      setInvitePending(false)
      return
    }
    try { setInvitePreview(await previewInvite(transport, inviteToken ?? '')) }
    catch (reason) { setInviteIssue(inviteIssueCode(reason)) }
    finally { setInvitePending(false) }
  }} style={insetsStyle} />
  if (invitePreview && inviteToken) return <IncomingInvite preview={invitePreview} style={insetsStyle} onAccept={async () => {
    setInvitePending(true)
    try {
      await acceptInvite(transport, inviteToken)
      const familyId = invitePreview.family.id
      setInvitePreview(null)
      await refreshHome(true)
      if (await selectFamily(familyId)) setInviteHandled(true)
      else setInviteIssue('UNKNOWN')
    } catch (reason) {
      setInviteIssue(inviteIssueCode(reason))
      setInvitePreview(null)
    } finally {
      setInvitePending(false)
    }
  }} />
  if (screen === 'hub' || !familyResponse) {
    const hubRole = home?.items.find((item) => item.membershipEpoch === selectedMembershipEpoch)?.role ?? home?.items[0]?.role ?? 'full'
    return <><div style={insetsStyle}><FamilyHubPage avatarAccessConfirmed={homeAccessConfirmed} busy={busy} error={homeError} home={home} loading={homeLoading} loadingMore={loadingMore} notice={notice} onCreate={() => void createOwnFamily()} onLoadMore={() => void loadMore()} onRetry={() => void refreshHome(true)} onSelect={(id) => void selectFamily(id)} transport={transport} /></div>{ownerGuideOpen ? <FamilyGuide role={hubRole} closeLabel="Закрыть знакомство" onClose={() => setOwnerGuideOpen(false)} /> : null}</>
  }
  const current = members.find((member) => member.userId === currentUserId)
  const selectedSummary = home?.items.find((item) => item.familyId === familyResponse.family.id && item.membershipEpoch === selectedMembershipEpoch)
  const currentRole = current?.role ?? selectedSummary?.role
  const familyChildList = familyChildren(familyResponse)
  // Only the v2 interface knows several children; legacy stays the one-child app.
  const feedChildProfiles = readUiVersion() === 'v2' ? familyChildList : undefined
  const editedChild = childEditor?.kind === 'edit' ? familyChildList.find((item) => item.id === childEditor.childId) : undefined
  const childEditorOpen = childEditor?.kind === 'add' || Boolean(editedChild)
  const finishChildEditor = async () => {
    await refreshSelected()
    await refreshHome()
    if (!familyResponse.child) setScreen('feed')
    else setChildEditor(null)
  }
  if ((!familyResponse.child && screen !== 'albums') || childEditorOpen) return <><div style={insetsStyle}><FamilyOnboarding key={childEditor?.kind === 'add' ? 'add' : editedChild ? `edit:${editedChild.id}:${editedChild.version}` : 'first'} addChild={childEditor?.kind === 'add'} canDelete={Boolean(current?.isOwner) && familyChildList.length >= 2} legacyProfileEndpoint={Boolean(editedChild) && editedChild?.id === familyResponse.child?.id} familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} initialChild={childEditor?.kind === 'add' ? undefined : editedChild ?? familyResponse.child ?? undefined} cancelLabel={familyResponse.child ? 'Отмена' : 'Все семьи'} onCancel={familyResponse.child ? () => setChildEditor(null) : () => returnHome()} onCompleted={finishChildEditor} onDeleted={finishChildEditor} onRefresh={async () => { await refreshSelected({ failureMode: 'throw' }) }} transport={transport} />{!familyResponse.child ? <BottomNavigation active="family" appearance="memoly" onAlbums={() => switchSurface('albums')} onFamily={() => undefined} onFeed={() => switchSurface('family')} role={currentRole === 'full' ? 'full' : 'viewer'} /> : null}</div>{ownerGuideOpen ? <FamilyGuide role={currentRole === 'full' ? 'full' : 'viewer'} closeLabel="Закрыть знакомство" onClose={() => setOwnerGuideOpen(false)} /> : null}</>
  const feedActive = screen === 'feed'
  const familyActive = screen === 'family'
  const giftsActive = screen === 'gifts'
  const feedMounted = visitedSurfaces.has('feed') || screen === 'feed'
  const familyMounted = visitedSurfaces.has('family') || screen === 'family'
  const giftsMounted = visitedSurfaces.has('gifts') || screen === 'gifts'
  const albumsActive = screen === 'albums'
  const albumsMounted = visitedSurfaces.has('albums') || albumsActive
  const albumScope = `${currentUserId}:${familyResponse.family.id}:${selectedMembershipEpoch ?? 'unconfirmed'}`
  const globalComposerOpen = globalComposerScope === albumScope && Boolean(familyResponse.child) && current?.role === 'full'
  return <><MemberAvatarDirectoryProvider accountId={currentUserId} familyId={familyResponse.family.id} key={`${currentUserId}:${familyResponse.family.id}:${selectedMembershipEpoch ?? 0}`} membershipEpoch={selectedMembershipEpoch ?? 0} seedMembers={members} transport={transport} enabled={avatarScopeConfirmed}>
  <>
    {familyResponse.child && feedMounted ? <div aria-hidden={!feedActive || globalComposerOpen} data-navigation-surface="feed" hidden={!feedActive || globalComposerOpen} style={insetsStyle}><FeedPage active={feedActive} key={familyResponse.family.id} accountId={currentUserId} childAvatarCrop={familyResponse.child.avatarCrop} childAvatarMediaId={familyResponse.child.avatarMediaId} childAvatarUrl={childAvatar.url} childAvatarStatus={childAvatar.status} childId={familyResponse.child.id} childName={familyResponse.child.name} childSubtitle={feedChildSubtitle(familyResponse.child.birthDate, familyResponse.family.timezone)} familyId={familyResponse.family.id} familyName={familyResponse.family.name} familyTimezone={familyResponse.family.timezone} filter={filter} hostBridge={hostBridge} insets={insets} isAppBootstrapped maxVideoUploadAcceptance={maxVideoPending} membershipEpoch={selectedMembershipEpoch} onAddRequestHandled={() => setOpenAddFromFamily(false)} onMaxVideoLaunchHandled={() => { maxVideoPendingRef.current = false; setMaxVideoPending(false) }} onSeenCandidate={(memoryId) => { if (selectedMembershipEpoch !== null) seenQueueRef.current?.enqueue({ accountId: currentUserId, familyId: familyResponse.family.id, membershipEpoch: selectedMembershipEpoch }, memoryId) }} openAddInitially={openAddFromFamily} onAccessLost={() => { seenQueueRef.current?.cancelFamily(familyResponse.family.id); returnHome('Доступ к этой семье закрыт.', familyResponse.family.id) }} onAllFamilies={() => returnHome()} onAlbums={() => { setOpenAddFromFamily(false); switchSurface('albums') }} onFamily={() => { setOpenAddFromFamily(false); switchSurface('family') }} onGifts={() => { setOpenAddFromFamily(false); switchSurface('gifts') }} onOpenChild={readUiVersion() === 'v2' && current?.isOwner ? () => { setChildEditor({ kind: 'edit', childId: familyResponse.child!.id }); setOpenAddFromFamily(false); switchSurface('family') } : undefined} onOpenSettings={readUiVersion() === 'v2' ? () => { setFamilySettingsRequest((request) => request + 1); setOpenAddFromFamily(false); switchSurface('family') } : undefined} onFilterChange={setFilter} childProfiles={feedChildProfiles} childFilter={childFilter} onChildFilterChange={setChildFilter} onChildFilterMissing={handleChildFilterMissing} childAvatarsEnabled={avatarScopeConfirmed} onOpenAlbum={(album) => { setAlbumOpenRequest((current) => ({ albumId: album.id, nonce: (current?.nonce ?? 0) + 1 })); setOpenAddFromFamily(false); switchSurface('albums') }} role={current?.role === 'full' ? 'full' : 'viewer'} transport={transport} unreadCount={home?.items.find((item) => item.familyId === familyResponse.family.id)?.unreadCount ?? null} unreadState={home?.items.find((item) => item.familyId === familyResponse.family.id)?.unreadState ?? 'unavailable'} /></div> : null}
    {familyResponse.child && familyMounted ? <div aria-hidden={!familyActive || globalComposerOpen} data-navigation-surface="family" hidden={!familyActive || globalComposerOpen} style={insetsStyle}><FamilyScreen active={familyActive} settingsRequest={familySettingsRequest} onSettingsRequestHandled={() => setFamilySettingsRequest(0)} canOpenInstall={isInstallOfferSupported(hostBridge)} installLabel={isMaxIos(hostBridge) ? 'Открыть в браузере' : 'Установить memoLy'} createInviteLink={hostBridge.inviteLink} currentUserId={currentUserId} familyResponse={familyResponse} childAvatar={childAvatar} hostBridge={hostBridge} invites={invites} members={members} onAdd={() => setGlobalComposerScope(albumScope)} onAlbums={() => switchSurface('albums')} onAllFamilies={() => returnHome()} onEditChild={(childId) => setChildEditor({ kind: 'edit', childId })} onAddChild={() => setChildEditor({ kind: 'add' })} childAvatarsEnabled={avatarScopeConfirmed} membershipEpoch={selectedMembershipEpoch} onFeed={() => { setOpenAddFromFamily(false); switchSurface('feed') }} onGifts={() => { setOpenAddFromFamily(false); switchSurface('gifts') }} onOpenInstall={() => { setPwaInstallDismissed({ setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) }, false); switchSurface('feed') }} onRefresh={refreshSelected} transport={transport} /></div> : null}
    {albumsMounted && selectedMembershipEpoch !== null ? <div aria-hidden={!albumsActive || globalComposerOpen} data-navigation-surface="albums" hidden={!albumsActive || globalComposerOpen} style={insetsStyle}><AlbumsPage accountId={currentUserId} active={albumsActive && !globalComposerOpen} child={familyResponse.child} childAvatar={childAvatar} childSubtitle={familyResponse.child ? feedChildSubtitle(familyResponse.child.birthDate, familyResponse.family.timezone) : 'Семейные истории'} childProfiles={feedChildProfiles} childFilter={childFilter} childAvatarsEnabled={avatarScopeConfirmed} onOpenChild={(childId) => { setChildFilter(childId); switchSurface('feed') }} familyId={familyResponse.family.id} familyName={familyResponse.family.name} hostBridge={hostBridge} key={albumScope} membershipEpoch={selectedMembershipEpoch} onAccessLost={() => { seenQueueRef.current?.cancelFamily(familyResponse.family.id); returnHome('Доступ к этой семье закрыт.', familyResponse.family.id) }} onAdd={() => setGlobalComposerScope(albumScope)} onAllFamilies={() => returnHome()} onFamily={() => switchSurface('family')} onFeed={() => switchSurface('feed')} onGifts={() => switchSurface('gifts')} openAlbumRequest={albumOpenRequest} onOpenAlbumRequestHandled={() => setAlbumOpenRequest(null)} role={currentRole === 'full' ? 'full' : 'viewer'} timezone={familyResponse.family.timezone} transport={transport} /></div> : null}
    {giftsMounted && familyResponse.child ? <div aria-hidden={!giftsActive || globalComposerOpen} data-navigation-surface="gifts" hidden={!giftsActive || globalComposerOpen} style={insetsStyle}><GiftsPage active={giftsActive && !globalComposerOpen} key={familyResponse.family.id} child={{ id: familyResponse.child.id, name: familyResponse.child.name }} currentUserId={currentUserId} familyId={familyResponse.family.id} hostBridge={hostBridge} isOwner={Boolean(current?.isOwner)} membershipEpoch={selectedMembershipEpoch} onAccessLost={() => { seenQueueRef.current?.cancelFamily(familyResponse.family.id); returnHome('Доступ к этой семье закрыт.', familyResponse.family.id) }} onAdd={() => setGlobalComposerScope(albumScope)} onAlbums={() => { setOpenAddFromFamily(false); switchSurface('albums') }} onFamily={() => { setOpenAddFromFamily(false); switchSurface('family') }} onFeed={() => { setOpenAddFromFamily(false); switchSurface('feed') }} role={current?.role === 'full' ? 'full' : 'viewer'} timeZone={familyResponse.family.timezone} transport={transport} /></div> : null}
    {globalComposerOpen && familyResponse.child ? <ComposerHost childId={familyResponse.child.id} childOptions={feedChildProfiles && feedChildProfiles.length >= 2 ? feedChildProfiles : undefined} initialChildIds={composerInitialChildIds(childFilter, familyChildList)} familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} hostBridge={hostBridge} key={`composer:${albumScope}`} onClose={() => setGlobalComposerScope(null)} transport={transport} /> : null}
  </>
  </MemberAvatarDirectoryProvider>{ownerGuideOpen ? <FamilyGuide role={currentRole === 'full' ? 'full' : 'viewer'} closeLabel="Закрыть знакомство" onClose={() => setOwnerGuideOpen(false)} /> : null}</>
}

function isInstallOfferSupported(hostBridge: HostBridge) {
  const platform = hostBridge.metadata()?.platform.toLowerCase() ?? ''
  return (hostBridge.kind === 'max' && ['android', 'ios', 'iphone', 'ipad'].includes(platform)) ||
    (hostBridge.kind === 'browser' && /android/i.test(navigator.userAgent))
}

function isMaxIos(hostBridge: HostBridge) {
  const platform = hostBridge.metadata()?.platform.toLowerCase() ?? ''
  return hostBridge.kind === 'max' && ['ios', 'iphone', 'ipad'].includes(platform)
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
