import type { CSSProperties } from 'react'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse, InvitePreviewResponse } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { EmptyState, FeedShell, FeedSkeleton, InlineError, type FeedFilter } from '@/features/feed'
import { AuthContext } from '@/features/auth'
import {
  acceptInvite,
  createFamilyBootstrap,
  FamilyOnboarding,
  FamilyScreen,
  loadFamily,
  loadFamilyInvites,
  loadFamilyMe,
  loadFamilyMembers,
  previewInvite,
} from '@/features/family'
import type { HostBridge } from '@/platform/telegram'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'
import type { AuthenticatedTransport } from '@/platform/api'

export type AppProps = { hostBridge: HostBridge }

export default function App({ hostBridge }: AppProps) {
  const auth = useContext(AuthContext)
  const telegramAttempted = useRef(false)
  const [telegramError, setTelegramError] = useState<Error | null>(null)

  useEffect(() => {
    const initData = hostBridge.initData()
    if (!auth || !hostBridge.isAvailable || auth.isBootstrapping || auth.isAuthenticated || !initData || telegramAttempted.current) return
    telegramAttempted.current = true
    void auth.authenticateTelegram(initData).catch((error: unknown) => {
      setTelegramError(error instanceof Error ? error : new Error('Не удалось войти через Telegram.'))
    })
  }, [auth, hostBridge])

  if (!hostBridge.isAvailable) return <OpenInTelegram />

  const insets = hostBridge.getInsets()
  const style = {
    '--host-inset-bottom': `${insets.bottom}px`,
    '--host-inset-left': `${insets.left}px`,
    '--host-inset-right': `${insets.right}px`,
    '--host-inset-top': `${insets.top}px`,
  } as CSSProperties
  if (!auth || auth.isBootstrapping) return <Loading style={style} />
  if (!auth.user) {
    return (
      <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}>
        <Typography variant="memoryScreen">Наши воспоминания</Typography>
        <div className="mt-8"><InlineError onRetry={() => {
          telegramAttempted.current = false
          setTelegramError(null)
          void auth.retrySession()
        }} /></div>
        {telegramError ? <Typography className="mt-3" tone="muted" variant="memoryMeta">Проверьте соединение и повторите попытку.</Typography> : null}
      </main>
    )
  }
  return <FamilyController currentUserId={auth.user.id} insets={insets} insetsStyle={style} inviteToken={hostBridge.inviteToken()} transport={auth.transport} />
}

function FamilyController({ currentUserId, insets, insetsStyle, inviteToken, transport }: { currentUserId: string; insets: TelegramInsets; insetsStyle: CSSProperties; inviteToken: string | null; transport: AuthenticatedTransport }) {
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

  const refresh = useCallback(async () => {
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
        } catch (reason) {
          setInviteIssue(inviteErrorCode(reason))
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
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('Не удалось загрузить семью.'))
    }
  }, [inviteHandled, inviteToken, transport])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  if (error) return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={insetsStyle}><InlineError onRetry={() => void refresh()} /></main>
  if (inviteIssue) return <InviteIssue code={inviteIssue} onRetry={refresh} style={insetsStyle} />
  if (invitePreview && inviteToken && !inviteHandled) return <InvitePreview preview={invitePreview} style={insetsStyle} onAccept={async () => {
    await acceptInvite(transport, inviteToken)
    setInviteHandled(true)
    setInvitePreview(null)
  }} />
  if (noFamily) return <NoFamily style={insetsStyle} onCreate={async () => {
    await createFamilyBootstrap(transport, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    await refresh()
  }} />
  if (!familyResponse) return <Loading style={insetsStyle} />
  if (!familyResponse.child || editingChild) return <div style={insetsStyle}><FamilyOnboarding familyId={familyResponse.family.id} initialChild={familyResponse.child ?? undefined} onCompleted={async () => { setEditingChild(false); setScreen('feed'); await refresh() }} transport={transport} /></div>
  const current = members.find((member) => member.userId === currentUserId)
  if (screen === 'feed') {
    return <div style={insetsStyle}><FeedShell activeFilter={filter} childName={familyResponse.child.name} childSubtitle={familyResponse.child.birthDate ?? 'Профиль ребёнка'} insets={insets} onFamily={() => setScreen('family')} onFeed={() => undefined} onFilterChange={setFilter} role={current?.role === 'viewer' ? 'viewer' : 'full'}><EmptyState mode={current?.role === 'viewer' ? 'viewer' : 'full'} /></FeedShell></div>
  }
  return <div style={insetsStyle}><FamilyScreen currentUserId={currentUserId} familyResponse={familyResponse} invites={invites} members={members} onEditChild={() => setEditingChild(true)} onFeed={() => setScreen('feed')} onRefresh={refresh} transport={transport} /></div>
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
  const copy: Record<string, string> = { OTHER_FAMILY: 'У вас уже есть другая активная семья. Сначала завершите работу с ней; текущее приглашение не использовано.', INVITE_EXPIRED: 'Срок действия приглашения истёк.', INVITE_REVOKED: 'Это приглашение отозвано.', INVITE_USED: 'Это приглашение уже использовано.', NOT_FOUND: 'Приглашение не найдено.', NETWORK: 'Не удалось проверить приглашение. Проверьте соединение.' }
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}><Typography variant="memoryScreen">Приглашение</Typography><Typography className="mt-8" variant="memoryBody">{copy[code] ?? copy.NOT_FOUND}</Typography>{code === 'NETWORK' ? <Button className="mt-6" onClick={() => void onRetry()} type="button"><Typography variant="memoryButton">Повторить</Typography></Button> : null}</main>
}

function NoFamily({ style, onCreate }: { style: CSSProperties; onCreate: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" style={style}><Typography variant="memoryScreen">Наши воспоминания</Typography><Typography className="mt-8" tone="muted" variant="memoryBody">Создайте семейную ленту, чтобы добавить профиль ребёнка.</Typography><Button className="mt-6" disabled={busy} onClick={() => void (async () => { setBusy(true); try { await onCreate() } finally { setBusy(false) } })()} type="button"><Typography variant="memoryButton">Создать семью</Typography></Button></main>
}

function inviteErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') return (error as { code: string }).code
  return 'NETWORK'
}

function Loading({ style }: { style?: CSSProperties }) {
  return <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-7 py-10" data-slot="app-loading" style={style}><Typography variant="memoryScreen">Наши воспоминания</Typography><div className="mt-8"><FeedSkeleton /></div></main>
}

function OpenInTelegram() {
  return (
    <main className="mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col px-7 py-10">
      <Typography variant="memoryHero">Наши воспоминания</Typography>
      <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
        <span className="flex size-18 items-center justify-center rounded-full bg-accent"><WebpIcon decorative name="info" size={32} state="active" /></span>
        <Typography className="mt-7 max-w-80" variant="memoryDialog">Откройте приложение в Telegram</Typography>
        <Typography className="mt-4 max-w-84" tone="muted" variant="memoryBody">В этой тестовой версии вход работает через нашего бота.</Typography>
        <Button aria-label="Открыть бота" asChild className="mt-7 min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]"><a href="https://t.me/OurMemoriesDevBot"><Typography variant="memoryButton">Открыть бота</Typography></a></Button>
      </div>
    </main>
  )
}
