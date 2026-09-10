import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useEffect, useState } from 'react'

import { AvatarLetter } from '@/features/session'
import { BottomNavigation } from '@/components/BottomNavigation'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { InlineError } from '@/features/feed'
import type { AuthenticatedTransport } from '@/platform/api'
import { createInvite, leaveFamily, revokeInvite, updateFamilyMember } from './api'
import { ageFromBirthDate, familyMemberName, roleLabel } from './model'

export function FamilyScreen({
  familyResponse,
  invites,
  members,
  transport,
  currentUserId,
  onInviteCreated,
  onEditChild,
  onFeed,
  onRefresh,
}: {
  familyResponse: FamilyResponse
  invites: FamilyInviteDto[]
  members: FamilyMemberDto[]
  transport: AuthenticatedTransport
  currentUserId: string
  onInviteCreated: (rawToken: string) => void
  onEditChild: () => void
  onFeed: () => void
  onRefresh: () => Promise<void>
}) {
  const [inviteRole, setInviteRole] = useState<'viewer' | 'full'>('viewer')
  const [inviteAlias, setInviteAlias] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const current = members.find((member) => member.userId === currentUserId)
  const isOwner = current?.isOwner === true
  const canInvite = isOwner || current?.role === 'full'
  const child = familyResponse.child
  const avatarUrl = useChildAvatar(transport, familyResponse.family.id, child?.avatarMediaId ?? null)

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
        {child ? <ChildCard avatarUrl={avatarUrl} child={child} onEdit={isOwner ? onEditChild : undefined} /> : null}
        {error ? <div className="mt-5"><InlineError onRetry={() => void onRefresh()} /></div> : null}

        <section className="mt-6" aria-labelledby="members-title">
          <Typography id="members-title" variant="memoryDialog">Участники</Typography>
          <div className="mt-3 flex flex-col gap-2">
            {members.map((member) => (
              <MemberCard
                canEditAlias={isOwner || (current?.role === 'full' && !member.isOwner)}
                canManageRole={isOwner && !member.isOwner}
                canRemove={isOwner && !member.isOwner}
                key={member.userId}
                member={member}
                onRemove={() => run(() => leaveFamily(transport, familyResponse.family.id, member.userId))}
                onSave={(input) => run(() => updateFamilyMember(
                  transport, familyResponse.family.id, member.userId, input,
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
                onInviteCreated(invitation.rawToken)
                setInviteAlias('')
                setInviteRole('viewer')
              })} type="button">
                <Typography variant="memoryButton">Создать приглашение</Typography>
              </Button>
            </div>
          </section>
        ) : null}

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
        {!isOwner ? (
          <Button className="mt-6 min-h-11 w-full" disabled={busy} onClick={() => {
            if (window.confirm('Выйти из семьи? Доступ к приватным материалам будет закрыт.')) {
              void run(() => leaveFamily(transport, familyResponse.family.id, currentUserId))
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

function ChildCard({ avatarUrl, child, onEdit }: { avatarUrl: string | null; child: NonNullable<FamilyResponse['child']>; onEdit?: () => void }) {
  const age = child.birthDate ? ageFromBirthDate(child.birthDate) : null
  return (
    <section className="mt-5 flex items-center gap-3 rounded-[var(--radius-card)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" aria-label="Профиль ребёнка">
      {avatarUrl ? <img alt={`Аватар ${child.name}`} className="size-11 rounded-full object-cover" src={avatarUrl} /> : <AvatarLetter name={child.name} />}
      <div className="min-w-0">
        <Typography className="truncate" variant="memoryChild">{child.name}</Typography>
        <Typography tone="muted" variant="memoryMeta">{age === null ? 'Профиль ребёнка' : `${age} ${ageWord(age)}`}</Typography>
      </div>
      {onEdit ? <Button className="ml-auto" onClick={onEdit} type="button" variant="ghost"><Typography variant="memoryMeta">Изменить</Typography></Button> : null}
    </section>
  )
}

function useChildAvatar(transport: AuthenticatedTransport, familyId: string, mediaId: string | null) {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!mediaId) return
    let cancelled = false
    let objectUrl: string | null = null
    void transport.raw(
      `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`,
    ).then(async (response) => {
      if (!response.ok) return
      objectUrl = URL.createObjectURL(await response.blob())
      if (cancelled) return
      setLoaded({ key: mediaId, url: objectUrl })
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [familyId, mediaId, transport])
  return mediaId && loaded?.key === mediaId ? loaded.url : null
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

function ageWord(age: number) {
  if (age % 10 === 1 && age % 100 !== 11) return 'год'
  if (age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 12 || age % 100 > 14)) return 'года'
  return 'лет'
}
