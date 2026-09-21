import type { CSSProperties } from 'react'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse, InvitePreviewResponse } from '@web-app-demo/contracts'

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
  inviteIssueMessage,
  previewInvite,
} from '@/features/family'
import type { HostBridge } from '@/platform/telegram'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'
import type { AuthenticatedTransport } from '@/platform/api'
import { isMaxVideoUploadAcceptanceLaunch, readMaxRuntimeDiagnostic, shouldShowMaxRuntimeDiagnostic, type MaxRuntimeDiagnostic } from '@/platform/max/host-bridge'

export type AppProps = { hostBridge: HostBridge }

export default function App({ hostBridge }: AppProps) {
  const auth = useContext(AuthContext)
  const hostAuthProvider: HostAuthProvider | null = hostBridge.kind === 'max' || hostBridge.kind === 'telegram'
    ? hostBridge.kind
    : null
  const initData = hostBridge.rawAuthData()
  const { authAttemptKey, hostAuthError, hasStartedHostAuth, isHostAuthPending, resetHostAuth, startedHostAuthKey } = useHostAuthHandoff({
    auth,
    initData,
    isHostAvailable: hostBridge.isAvailable,
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
  } : null, [auth, authAttemptKey, hasStartedHostAuth, hostAuthProvider, initData, isHostAuthPending, startedHostAuthKey, hostBridge.isAvailable])

  if (!hostBridge.isAvailable) return <OpenInTelegram />

  const insets = hostBridge.getInsets()
  const style = {
    '--host-inset-bottom': `${insets.bottom}px`,
    '--host-inset-left': `${insets.left}px`,
    '--host-inset-right': `${insets.right}px`,
    '--host-inset-top': `${insets.top}px`,
  } as CSSProperties
  if (!auth || auth.isBootstrapping || (hostAuthState && shouldKeepHostAuthPreloader(hostAuthState))) return <BootPreloader style={style} />
  if (!auth.user) {
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
  const [screen, setScreen] = useState<'family' | 'feed'>('family')
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [invitePreview, setInvitePreview] = useState<InvitePreviewResponse | null>(null)
  const [inviteIssue, setInviteIssue] = useState<string | null>(null)
  const [inviteHandled, setInviteHandled] = useState(false)
  const [noFamily, setNoFamily] = useState(false)
  const [accessLost, setAccessLost] = useState(false)
  const [isFamilyBootstrapping, setIsFamilyBootstrapping] = useState(true)

  const refresh = useCallback(async ({ bootstrap = false }: { bootstrap?: boolean } = {}) => {
    if (bootstrap) setIsFamilyBootstrapping(true)
    setError(null)
    setInviteIssue(null)
    setNoFamily(false)
    try {
      const me = await loadFamilyMe(transport)
      if (inviteToken && !inviteHandled) {
        try {
          const preview = await previewInvite(transport, inviteToken)
          if (me.activeFamily && me.activeFamily.id !== preview.family.id) {
            setInviteIssue('OTHER_FAMILY')
            setFamilyResponse(null)
            return
          }
          if (!me.activeFamily) {
            setInvitePreview(preview)
            setFamilyResponse(null)
            return
          }
          setInviteHandled(true)
        } catch (reason) {
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
          loadFamilyInvites(transport, response.family.id).catch(() => ({ items: [] })),
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
      setError(reason instanceof Error ? reason : new Error('Не удалось загрузить семью.'))
    } finally {
      if (bootstrap) setIsFamilyBootstrapping(false)
    }
  }, [inviteHandled, inviteToken, transport])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh({ bootstrap: true }) }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  if (isFamilyBootstrapping) return <BootPreloader style={insetsStyle} />
  if (error) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={insetsStyle}><InlineError onRetry={() => void refresh()} /></main>
  if (inviteIssue) return <InviteIssue code={inviteIssue} onRetry={refresh} style={insetsStyle} />
  if (invitePreview && inviteToken && !inviteHandled) return <InvitePreview preview={invitePreview} style={insetsStyle} onAccept={async () => {
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
  if (!familyResponse.child || editingChild) return <div style={insetsStyle}><FamilyOnboarding familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} initialChild={familyResponse.child ?? undefined} onCancel={familyResponse.child ? () => setEditingChild(false) : undefined} onCompleted={async () => { await refresh({ bootstrap: true }); setEditingChild(false) }} transport={transport} /></div>
  const current = members.find((member) => member.userId === currentUserId)
  if (screen === 'feed') {
    return <div style={insetsStyle}><FeedPage childAvatarCrop={familyResponse.child.avatarCrop} childAvatarMediaId={familyResponse.child.avatarMediaId} childId={familyResponse.child.id} childName={familyResponse.child.name} childSubtitle={feedChildSubtitle(familyResponse.child.birthDate, familyResponse.family.timezone)} familyId={familyResponse.family.id} familyTimezone={familyResponse.family.timezone} filter={filter} hostBridge={hostBridge} insets={insets} isAppBootstrapped maxVideoUploadAcceptance={maxVideoUploadAcceptance} onAccessLost={() => setAccessLost(true)} onFamily={() => setScreen('family')} onFilterChange={setFilter} role={current?.role === 'viewer' ? 'viewer' : 'full'} transport={transport} /></div>
  }
  return <div style={insetsStyle}><FamilyScreen createInviteLink={hostBridge.inviteLink} currentUserId={currentUserId} familyResponse={familyResponse} invites={invites} members={members} onEditChild={() => setEditingChild(true)} onFeed={() => setScreen('feed')} onRefresh={refresh} transport={transport} /></div>
}

function InvitePreview({ preview, style, onAccept }: { preview: InvitePreviewResponse; style: CSSProperties; onAccept: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
    <Typography variant="memoryScreen">Приглашение в семью</Typography>
    <section className="mt-8 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]">
      <Typography variant="memoryHero">{preview.family.name}</Typography>
      <Typography className="mt-3" tone="muted" variant="memoryBody">Вам предложен доступ: {preview.role === 'full' ? 'полный' : 'просмотр'}. Ссылка одноразовая и действует до {new Date(preview.expiresAt).toLocaleString('ru-RU')}.</Typography>
      {failed ? <Typography className="mt-3 text-destructive" role="alert" variant="memoryMeta">Не удалось присоединиться. Проверьте приглашение и повторите.</Typography> : null}
      <Button className="mt-6 min-h-12 w-full" disabled={busy} onClick={() => void (async () => { setBusy(true); setFailed(false); try { await onAccept() } catch { setFailed(true) } finally { setBusy(false) } })()} type="button"><Typography variant="memoryButton">Присоединиться</Typography></Button>
    </section>
  </main>
}

function InviteIssue({ code, onRetry, style }: { code: string; onRetry: () => Promise<void>; style: CSSProperties }) {
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}><Typography variant="memoryScreen">Приглашение</Typography><Typography className="mt-8" variant="memoryBody">{inviteIssueMessage(code)}</Typography>{!terminalInviteIssueCodes.has(code) ? <Button className="mt-6" onClick={() => void onRetry()} type="button"><Typography variant="memoryButton">Повторить</Typography></Button> : null}</main>
}

const terminalInviteIssueCodes = new Set(['OTHER_FAMILY', 'ALREADY_IN_FAMILY', 'INVITE_EXPIRED', 'INVITE_REVOKED', 'INVITE_USED', 'NOT_FOUND'])

function NoFamily({ style, onCreate }: { style: CSSProperties; onCreate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}><BrandLogo className="w-[148px]" /><Typography className="mt-8" tone="muted" variant="memoryBody">Создайте семейную ленту, чтобы добавить профиль ребёнка.</Typography><Button className="mt-6" disabled={busy} onClick={() => void (async () => { setBusy(true); setCreateError(null); try { await onCreate() } catch (error) { setCreateError(createFamilyErrorMessage(error)) } finally { setBusy(false) } })()} type="button"><Typography variant="memoryButton">Создать семью</Typography></Button>{createError ? <Typography className="mt-3 text-destructive" role="alert" variant="memoryMeta">{createError}</Typography> : null}</main>
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
