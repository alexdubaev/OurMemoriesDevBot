import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useEffect, useState } from 'react'

import { AvatarLetter } from '@/features/session'
import { BottomNavigation } from '@/components/BottomNavigation'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { InlineError } from '@/features/feed'
import type { AuthenticatedTransport } from '@/platform/api'
import { createInvite, leaveFamily, loadFamilyUsage, revokeInvite, updateFamilyMember } from './api'
import { formatChildAge, familyMemberName, roleLabel } from './model'
import { ChildAvatar } from './ChildAvatar'
import { useChildAvatar } from './useChildAvatar'

export function FamilyScreen({
  familyResponse,
  invites,
  members,
  transport,
  currentUserId,
  onEditChild,
  onFeed,
  onRefresh,
  createInviteLink,
}: {
  familyResponse: FamilyResponse
  invites: FamilyInviteDto[]
  members: FamilyMemberDto[]
  transport: AuthenticatedTransport
  currentUserId: string
  onEditChild: () => void
  onFeed: () => void
  onRefresh: () => Promise<void>
  createInviteLink: (rawToken: string) => string | null
}) {
  const [inviteRole, setInviteRole] = useState<'viewer' | 'full'>('viewer')
  const [inviteAlias, setInviteAlias] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviteReady, setInviteReady] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number | null } | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  const current = members.find((member) => member.userId === currentUserId)
  const isOwner = current?.isOwner === true
  const child = familyResponse.child
  const canInvite = (isOwner || current?.role === 'full') && child?.isComplete === true
  const avatarUrl = useChildAvatar(transport, familyResponse.family.id, child?.avatarMediaId ?? null)

  const refreshUsage = () => void loadFamilyUsage(transport, familyResponse.family.id).then((next) => {
    setUsage(next); setUsageFailed(false)
  }).catch(() => setUsageFailed(true))
  useEffect(refreshUsage, [familyResponse.family.id, transport])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onRefresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('Не удалось обновить семью.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen min-h-dvh bg-background">
      <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-[calc(var(--layout-gutter)+var(--host-inset-left))] pb-[calc(var(--layout-bottom-nav)+var(--layout-gutter)+var(--host-inset-bottom))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))]">
        <Typography variant="memoryScreen">Семья</Typography>
        {child ? <ChildCard avatarUrl={avatarUrl} child={child} onEdit={isOwner ? onEditChild : undefined} timezone={familyResponse.family.timezone} /> : null}
        {error ? <div className="mt-5"><InlineError onRetry={() => void onRefresh()} /></div> : null}
        <section className="mt-5 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" aria-labelledby="usage-title">
          <Typography id="usage-title" variant="memoryDialog">Архив семьи</Typography>
          {usage ? <><Typography className="mt-2" tone="muted" variant="memoryBody">Использовано {formatBytes(usage.usedBytes)}{usage.quotaBytes ? ` из ${formatBytes(usage.quotaBytes)}` : ''}</Typography>{usage.quotaBytes ? <div aria-label="Использование архива" className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }} /></div> : null}</> : null}
          {usageFailed ? <Button className="mt-2" onClick={refreshUsage} type="button" variant="ghost"><Typography variant="memoryMeta">Повторить загрузку объёма</Typography></Button> : null}
        </section>

        <section className="mt-6" aria-labelledby="members-title">
          <Typography id="members-title" variant="memoryDialog">Участники</Typography>
          <div className="mt-3 flex flex-col gap-2">
            {members.map((member) => (
              <MemberCard
                canEditAlias={!member.isOwner && (isOwner || current?.role === 'full')}
                canManageRole={isOwner && !member.isOwner}
                canRemove={isOwner && !member.isOwner}
                key={member.userId}
                member={member}
                onRemove={() => run(() => leaveFamily(
                  transport, familyResponse.family.id, member.userId, member.version,
                ))}
                onSave={(input) => run(() => updateFamilyMember(
                  transport, familyResponse.family.id, member.userId, { ...input, expectedVersion: member.version },
                ))}
              />
            ))}
          </div>
        </section>

        {canInvite ? (
          <section className="mt-7" aria-labelledby="invite-title">
            <Typography id="invite-title" variant="memoryDialog">Пригласить в семью</Typography>
            <div className="mt-3 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]">
              <label className="flex flex-col gap-2" htmlFor="invite-alias">
                <Typography tone="muted" variant="memoryMeta">Имя в семье (необязательно)</Typography>
                <input
                  className="min-h-11 rounded-[var(--radius-field)] border bg-background px-3"
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
              <Button className="mt-4 min-h-11 w-full" disabled={busy} onClick={() => void run(async () => {
                const invitation = await createInvite(transport, familyResponse.family.id, {
                  role: inviteRole,
                  inviteeDisplayName: inviteAlias || undefined,
                })
                const url = createInviteLink(invitation.rawToken)
                if (!url) throw new Error('Не удалось создать ссылку приглашения.')
                setInviteReady({ url, expiresAt: invitation.expiresAt })
                setInviteAlias('')
                setInviteRole('viewer')
              })} type="button">
                <Typography variant="memoryButton">Создать приглашение</Typography>
              </Button>
            </div>
          </section>
        ) : null}

        {inviteReady ? <section className="mt-7 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" aria-labelledby="invite-ready-title">
          <Typography id="invite-ready-title" variant="memoryDialog">Приглашение готово</Typography>
          <Typography className="mt-2" tone="muted" variant="memoryBody">Одноразовая ссылка действует до {new Date(inviteReady.expiresAt).toLocaleString('ru-RU')}.</Typography>
          <input aria-label="Ссылка приглашения" className="mt-4 min-h-11 w-full rounded-[var(--radius-field)] border bg-background px-3" readOnly value={inviteReady.url} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={() => void (async () => { try { await navigator.clipboard.writeText(inviteReady.url); setCopyState('copied') } catch { setCopyState('failed') } })()} type="button"><Typography variant="memoryButton">Скопировать</Typography></Button>
            <Button onClick={() => void (async () => { if (!navigator.share) return; try { await navigator.share({ url: inviteReady.url }); } catch { /* sharing was cancelled or unavailable */ } })()} type="button" variant="outline"><Typography variant="memoryButton">Поделиться</Typography></Button>
          </div>
          {copyState === 'copied' ? <Typography className="mt-2" role="status" tone="muted" variant="memoryMeta">Ссылка скопирована.</Typography> : null}
          {copyState === 'failed' ? <Typography className="mt-2" role="alert" tone="muted" variant="memoryMeta">Скопируйте ссылку вручную из поля выше.</Typography> : null}
          <Button className="mt-4 w-full" onClick={() => { setInviteReady(null); setCopyState('idle') }} type="button" variant="ghost"><Typography variant="memoryButton">Готово</Typography></Button>
        </section> : null}

        {canInvite ? (
          <section className="mt-7" aria-labelledby="pending-title">
            <Typography id="pending-title" variant="memoryDialog">Ожидают приглашение</Typography>
            {invites.length === 0 ? <Typography className="mt-2" tone="muted" variant="memoryBody">Нет активных приглашений.</Typography> : (
              <div className="mt-3 flex flex-col gap-2">
                {invites.map((invite) => (
                  <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-4 shadow-[var(--shadow-card)]" key={invite.id}>
                    <div className="min-w-0 flex-1">
                      <Typography className="truncate" variant="memoryBody">{invite.inviteeDisplayName ?? 'Новое приглашение'}</Typography>
                      <Typography tone="muted" variant="memoryMeta">{invite.role === 'full' ? 'Полный доступ' : 'Просмотр'} · до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}</Typography>
                    </div>
                    <Button disabled={busy} onClick={() => void run(() => revokeInvite(transport, familyResponse.family.id, invite.id))} type="button" variant="ghost">
                      <Typography variant="memoryMeta">Отозвать</Typography>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        <section className="mt-7 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" aria-labelledby="privacy-title">
          <Typography id="privacy-title" variant="memoryDialog">Помощь и приватность</Typography>
          <Typography className="mt-2" tone="muted" variant="memoryBody">Воспоминания и фотографии семьи доступны только участникам этой семьи.</Typography>
        </section>
        {current && !isOwner ? (
          <Button className="mt-6 min-h-11 w-full" disabled={busy} onClick={() => {
            if (window.confirm('Выйти из семьи? Доступ к приватным материалам будет закрыт.')) {
              void run(() => leaveFamily(
                transport, familyResponse.family.id, currentUserId, current.version,
              ))
            }
          }} type="button" variant="outline">
            <Typography variant="memoryButton">Выйти из семьи</Typography>
          </Button>
        ) : null}
      </main>
      <BottomNavigation active="family" onFamily={() => undefined} onFeed={onFeed} role={current?.role === 'viewer' ? 'viewer' : 'full'} />
    </div>
  )
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`
  return `${(value / 1024 / 1024).toFixed(1)} МБ`
}

function ChildCard({ avatarUrl, child, onEdit, timezone }: { avatarUrl: string | null; child: NonNullable<FamilyResponse['child']>; onEdit?: () => void; timezone: string }) {
  const age = child.birthDate ? formatChildAge(child.birthDate, timezone) : null
  return (
    <section className="mt-5 flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" aria-label="Профиль ребёнка">
      <ChildAvatar avatarCrop={child.avatarCrop} avatarUrl={avatarUrl} name={child.name} size="family-card" />
      <div className="min-w-0">
        <Typography className="truncate" variant="memoryChild">{child.name}</Typography>
        <Typography tone="muted" variant="memoryMeta">{age ?? 'Профиль ребёнка'}{child.birthDate ? ` · ${child.birthDate}` : ''}</Typography>
      </div>
      {onEdit ? <Button className="ml-auto" onClick={onEdit} type="button" variant="ghost"><Typography variant="memoryMeta">Изменить</Typography></Button> : null}
    </section>
  )
}

function MemberCard({
  canEditAlias,
  canManageRole,
  canRemove,
  member,
  onRemove,
  onSave,
}: {
  canEditAlias: boolean
  canManageRole: boolean
  canRemove: boolean
  member: FamilyMemberDto
  onRemove: () => Promise<void>
  onSave: (input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void>
}) {
  const [alias, setAlias] = useState(member.familyDisplayName ?? '')
  return (
    <article className="rounded-[var(--radius-card)] bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3">
        <AvatarLetter name={familyMemberName(member)} />
        <div className="min-w-0 flex-1">
          <Typography className="truncate" variant="memoryBody">{familyMemberName(member)}</Typography>
          <Typography tone="muted" variant="memoryMeta">{roleLabel(member.role, member.isOwner)}</Typography>
        </div>
      </div>
      {canEditAlias ? (
        <div className="mt-3 flex gap-2">
          <input aria-label={`Имя в семье: ${familyMemberName(member)}`} className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-field)] border bg-background px-3" maxLength={64} onChange={(event) => setAlias(event.target.value)} value={alias} />
          <Button onClick={() => void onSave({ familyDisplayName: alias || null })} type="button" variant="ghost"><Typography variant="memoryMeta">Сохранить</Typography></Button>
        </div>
      ) : null}
      {canManageRole ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <RoleChoice active={member.role === 'viewer'} label="Просмотр" onClick={() => void onSave({ role: 'viewer' })} />
          <RoleChoice active={member.role === 'full'} label="Полный доступ" onClick={() => void onSave({ role: 'full' })} />
        </div>
      ) : null}
      {canRemove ? <Button className="mt-3" onClick={() => {
        if (window.confirm(`Удалить «${familyMemberName(member)}» из семьи?`)) void onRemove()
      }} type="button" variant="ghost"><Typography variant="memoryMeta">Удалить участника</Typography></Button> : null}
    </article>
  )
}

function RoleChoice({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={active ? 'min-h-10 rounded-[var(--radius-field)] bg-accent text-accent-foreground' : 'min-h-10 rounded-[var(--radius-field)] bg-background text-muted-foreground'} onClick={onClick} type="button"><Typography variant="memoryMeta">{label}</Typography></button>
}
