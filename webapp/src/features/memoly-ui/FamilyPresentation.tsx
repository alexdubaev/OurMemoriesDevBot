import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useRef, useState } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { ChildHeader } from '@/components/ChildHeader'
import { Typography } from '@/components/typography'
import { Button } from '@/components/ui/button'
import { InlineError } from '@/features/feed'
import { familyMemberName, feedChildSubtitle, roleLabel } from '@/features/family'
import { AvatarLetter } from '@/features/session'
import { useMemolyTheme } from '@/features/theme'
import type { HostBridge } from '@/platform/host-bridge'
import { SettingsSheet } from './SettingsSheet'

export type FamilyMemberActions = {
  canEditAlias: boolean
  canManageRole: boolean
  canRemove: boolean
}

export type FamilyPresentationProps = {
  familyResponse: FamilyResponse
  hostBridge: Pick<HostBridge, 'onBack'>
  invites: FamilyInviteDto[]
  members: FamilyMemberDto[]
  childAvatarUrl: string | null
  usage: { usedBytes: number; quotaBytes: number | null } | null
  usageFailed: boolean
  inviteReady: { url: string; expiresAt: string } | null
  copyState: 'idle' | 'copied' | 'failed'
  busy: boolean
  hasError?: boolean
  canInvite: boolean
  canEditChild: boolean
  canLeaveFamily: boolean
  memberActions: Record<string, FamilyMemberActions>
  onRefresh: () => void
  onRefreshUsage: () => void
  onEditChild: () => void
  onCreateInvite: (input: { role: 'viewer' | 'full'; inviteeDisplayName?: string }) => Promise<void>
  onCopyInvite: () => Promise<void>
  onShareInvite: () => Promise<void>
  onCloseInvite: () => void
  onRevokeInvite: (invite: FamilyInviteDto) => Promise<void>
  onUpdateMember: (member: FamilyMemberDto, input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void>
  onRemoveMember: (member: FamilyMemberDto) => Promise<void>
  onLeaveFamily: () => Promise<void>
}

export function FamilyPresentation({
  familyResponse,
  hostBridge,
  invites,
  members,
  childAvatarUrl,
  usage,
  usageFailed,
  inviteReady,
  copyState,
  busy,
  hasError = false,
  canInvite,
  canEditChild,
  canLeaveFamily,
  memberActions,
  onRefresh,
  onRefreshUsage,
  onEditChild,
  onCreateInvite,
  onCopyInvite,
  onShareInvite,
  onCloseInvite,
  onRevokeInvite,
  onUpdateMember,
  onRemoveMember,
  onLeaveFamily,
}: FamilyPresentationProps) {
  const [inviteRole, setInviteRole] = useState<'viewer' | 'full'>('viewer')
  const [inviteAlias, setInviteAlias] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTriggerRef = useRef<HTMLElement | null>(null)
  const { theme } = useMemolyTheme()
  const child = familyResponse.child

  return (
    <main className="ml-family-content" data-slot="family-presentation">
      <ChildHeader
        childAvatarCrop={child?.avatarCrop ?? null}
        childAvatarUrl={childAvatarUrl}
        childName={child?.name ?? 'Ребёнок'}
        childSubtitle={child ? feedChildSubtitle(child.birthDate, familyResponse.family.timezone) : 'Профиль ребёнка'}
        mode="family"
        onOpenChild={canEditChild && child ? onEditChild : undefined}
        onOpenSettings={() => {
          if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) settingsTriggerRef.current = document.activeElement
          setSettingsOpen(true)
        }}
        theme={theme}
      />

      <section aria-labelledby="family-title" className="ml-family-meta">
        <div className="min-w-0 flex-1">
          <Typography as="h1" id="family-title" variant="memoryScreen">{familyResponse.family.name}</Typography>
          <Typography className="mt-1" tone="muted" variant="memoryBody">Участники семьи · {members.length}</Typography>
        </div>
        {canEditChild && child ? <Button aria-label="Изменить профиль ребёнка" className="ml-family-edit" onClick={onEditChild} type="button" variant="ghost"><Typography variant="memoryMeta">Изменить</Typography></Button> : null}
      </section>

      {hasError ? <div className="mb-4"><InlineError onRetry={onRefresh} /></div> : null}

      <section aria-labelledby="members-title" className="ml-family-section">
        <Typography as="h2" id="members-title" variant="memoryDialog">Близкие</Typography>
        <div className="ml-member-list">
          {members.map((member) => (
            <MemberRow
              actions={memberActions[member.userId] ?? { canEditAlias: false, canManageRole: false, canRemove: false }}
              key={member.userId}
              member={member}
              onRemove={onRemoveMember}
              onSave={onUpdateMember}
            />
          ))}
        </div>
      </section>

      {canInvite ? (
        <section aria-labelledby="invite-title" className="mt-4">
          <Typography as="h2" className="sr-only" id="invite-title" variant="memoryDialog">Пригласить в семью</Typography>
          <div className="rounded-[var(--radius-card)] bg-primary px-4 py-3 text-primary-foreground shadow-[var(--shadow-card)]">
            <Typography as="p" className="mb-3" variant="memoryButton">Пригласить близкого</Typography>
            <label className="flex flex-col gap-2" htmlFor="invite-alias">
              <Typography className="text-primary-foreground/80" variant="memoryMeta">Имя в семье (необязательно)</Typography>
              <input
                className="min-h-11 rounded-[var(--radius-field)] border border-primary-foreground/20 bg-card px-3 text-foreground"
                id="invite-alias"
                maxLength={64}
                onChange={(event) => setInviteAlias(event.target.value)}
                placeholder="Например, Бабушка Оля"
                value={inviteAlias}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <RoleChoice active={inviteRole === 'viewer'} label="Просмотр" onClick={() => setInviteRole('viewer')} />
              <RoleChoice active={inviteRole === 'full'} label="Полный доступ" onClick={() => setInviteRole('full')} />
            </div>
            <Button className="mt-3 min-h-11 w-full bg-card text-foreground hover:bg-card/90" disabled={busy} onClick={() => void onCreateInvite({ role: inviteRole, inviteeDisplayName: inviteAlias || undefined }).then(() => { setInviteAlias(''); setInviteRole('viewer') }).catch(() => undefined)} type="button">
              <Typography variant="memoryButton">Создать приглашение</Typography>
            </Button>
          </div>
        </section>
      ) : null}

      {inviteReady ? (
        <section aria-labelledby="invite-ready-title" className="ml-panel mt-4">
          <Typography as="h2" id="invite-ready-title" variant="memoryDialog">Приглашение готово</Typography>
          <Typography className="mt-2" tone="muted" variant="memoryBody">Одноразовая ссылка действует до {new Date(inviteReady.expiresAt).toLocaleString('ru-RU')}.</Typography>
          <input aria-label="Ссылка приглашения" className="mt-4 min-h-11 w-full rounded-[var(--radius-field)] border bg-background px-3" readOnly value={inviteReady.url} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button disabled={busy} onClick={() => void onCopyInvite()} type="button"><Typography variant="memoryButton">Скопировать</Typography></Button>
            <Button disabled={busy} onClick={() => void onShareInvite()} type="button" variant="outline"><Typography variant="memoryButton">Поделиться</Typography></Button>
          </div>
          {copyState === 'copied' ? <Typography className="mt-2" role="status" tone="muted" variant="memoryMeta">Ссылка скопирована.</Typography> : null}
          {copyState === 'failed' ? <Typography className="mt-2" role="alert" tone="muted" variant="memoryMeta">Скопируйте ссылку вручную из поля выше.</Typography> : null}
          <Button className="mt-4 w-full" onClick={onCloseInvite} type="button" variant="ghost"><Typography variant="memoryButton">Готово</Typography></Button>
        </section>
      ) : null}

      {canInvite ? (
        <section aria-labelledby="pending-title" className="ml-family-section">
          <Typography as="h2" id="pending-title" variant="memoryDialog">Ожидают приглашение</Typography>
          {invites.length === 0 ? <Typography className="mt-2" tone="muted" variant="memoryBody">Нет активных приглашений.</Typography> : (
            <div className="mt-2 flex flex-col">
              {invites.map((invite) => (
                <div className="flex min-h-16 items-center gap-3 border-b border-border py-3" key={invite.id}>
                  <div className="min-w-0 flex-1">
                    <Typography className="truncate" variant="memoryBody">{invite.inviteeDisplayName ?? 'Новое приглашение'}</Typography>
                    <Typography tone="muted" variant="memoryMeta">{invite.role === 'full' ? 'Полный доступ' : 'Просмотр'} · до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}</Typography>
                  </div>
                  <Button disabled={busy} onClick={() => void onRevokeInvite(invite)} type="button" variant="ghost"><Typography variant="memoryMeta">Отозвать</Typography></Button>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section aria-labelledby="usage-title" className="ml-panel ml-family-section">
        <Typography as="h2" id="usage-title" variant="memoryDialog">Семейный архив</Typography>
        {usage ? <>
          <Typography className="mt-2" tone="muted" variant="memoryBody">Использовано {formatBytes(usage.usedBytes)}{usage.quotaBytes ? ` из ${formatBytes(usage.quotaBytes)}` : ''}</Typography>
          {usage.quotaBytes ? <div aria-label="Использование архива" className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }} /></div> : null}
        </> : null}
        {usageFailed ? <Button className="mt-2" onClick={onRefreshUsage} type="button" variant="ghost"><Typography variant="memoryMeta">Повторить загрузку объёма</Typography></Button> : null}
      </section>

      <section aria-labelledby="privacy-title" className="ml-family-privacy">
        <div className="flex items-center gap-3">
          <WebpIcon decorative name="info" size={24} />
          <Typography as="h2" className="min-w-0 flex-1" id="privacy-title" variant="memoryBody">Помощь и приватность</Typography>
          <WebpIcon decorative name="chevron" size={22} />
        </div>
        <Typography className="mt-3" tone="muted" variant="memoryBody">Воспоминания и фотографии семьи доступны только участникам этой семьи.</Typography>
      </section>

      {canLeaveFamily ? <Button className="mt-4 min-h-11 w-full" disabled={busy} onClick={() => { if (window.confirm('Выйти из семьи? Доступ к приватным материалам будет закрыт.')) void onLeaveFamily() }} type="button" variant="outline"><Typography variant="memoryButton">Выйти из семьи</Typography></Button> : null}
      <SettingsSheet hostBridge={hostBridge} onOpenChange={setSettingsOpen} open={settingsOpen} returnFocusRef={settingsTriggerRef} />
    </main>
  )
}

function MemberRow({ actions, member, onRemove, onSave }: { actions: FamilyMemberActions; member: FamilyMemberDto; onRemove: (member: FamilyMemberDto) => Promise<void>; onSave: (member: FamilyMemberDto, input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void> }) {
  const [alias, setAlias] = useState(member.familyDisplayName ?? '')
  const displayName = familyMemberName(member)
  return (
    <article className="ml-member" data-slot="family-member">
      <AvatarLetter className="size-11" name={displayName} size="lg" />
      <div className="min-w-0">
        <Typography className="truncate" variant="memoryBody">{displayName}</Typography>
        <Typography tone="muted" variant="memoryMeta">{roleLabel(member.role, member.isOwner)}</Typography>
        {actions.canEditAlias ? <div className="mt-2 flex gap-2"><input aria-label={`Имя в семье: ${displayName}`} className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-field)] border bg-background px-3" maxLength={64} onChange={(event) => setAlias(event.target.value)} value={alias} /><Button onClick={() => void onSave(member, { familyDisplayName: alias || null })} type="button" variant="ghost"><Typography variant="memoryMeta">Сохранить</Typography></Button></div> : null}
        {actions.canManageRole ? <div className="mt-2 grid grid-cols-2 gap-2"><RoleChoice active={member.role === 'viewer'} label="Просмотр" onClick={() => void onSave(member, { role: 'viewer' })} /><RoleChoice active={member.role === 'full'} label="Полный доступ" onClick={() => void onSave(member, { role: 'full' })} /></div> : null}
        {actions.canRemove ? <Button className="mt-2" onClick={() => { if (window.confirm(`Удалить «${displayName}» из семьи?`)) void onRemove(member) }} type="button" variant="ghost"><Typography variant="memoryMeta">Удалить участника</Typography></Button> : null}
      </div>
      {member.isOwner ? <span className="ml-role"><Typography variant="memoryMeta">Создатель</Typography></span> : null}
    </article>
  )
}

function RoleChoice({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={active ? 'min-h-10 rounded-[var(--radius-field)] bg-accent text-accent-foreground' : 'min-h-10 rounded-[var(--radius-field)] bg-background text-muted-foreground'} onClick={onClick} type="button"><Typography variant="memoryMeta">{label}</Typography></button>
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`
  return `${(value / 1024 / 1024).toFixed(1)} МБ`
}
