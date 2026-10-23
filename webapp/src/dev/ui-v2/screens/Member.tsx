import { useState } from 'react'
import { Avatar, Badge, Button } from '../primitives/controls'
import { Field, TextField } from '../primitives/forms'
import { Typography } from '../primitives/Typography'
import { InlineNotice, LoadingState } from '../components/Feedback'
import { photos } from '../fixtures/data'
import { PageContent, TopBar } from './common'
import type { ScreenProps } from './types'
export function Member({ entry, people, selectedPerson, role, actions }: ScreenProps) {
  const state = entry.state
  const owner = state === 'owner'
  const self = state === 'self' || state.startsWith('avatar')
  const person = self ? people[0] : selectedPerson ?? (owner ? people[0] : state === 'full' ? people[1] : people[2]) ?? people[0]
  const [name, setName] = useState(person.name)
  const [access, setAccess] = useState<'full' | 'viewer'>(person.role === 'viewer' ? 'viewer' : 'full')
  const [avatar, setAvatar] = useState(person.avatar)
  const [saved, setSaved] = useState(state === 'saved')
  const canEdit = self || !owner && role !== 'viewer'
  const canManage = !owner && !self && role === 'owner'
  return <><TopBar title={self ? 'Мой профиль' : owner ? 'Профиль владельца' : 'Профиль участника'} onBack={() => actions.go('family:' + role)} /><PageContent><div className="v2-profile-intro"><Avatar name={name} src={avatar} large /><Typography as="h1" variant="title">{name}</Typography><Badge>{owner ? 'Владелец семьи' : self ? 'Ваш профиль' : person.subtitle}</Badge></div>
    {self && <><Button tone="secondary" onPress={() => { setAvatar(photos.painting); actions.onNotice('Demo-фотография профиля обновлена') }}>Изменить фотографию</Button>{avatar && <Button tone="quiet" onPress={() => { setAvatar(undefined); actions.onNotice('Demo-фотография удалена') }}>Удалить фотографию</Button>}</>}
    <form className="v2-stack" onSubmit={e => { e.preventDefault(); actions.onSavePerson(person.id, name.trim(), canManage ? access : undefined, avatar); setSaved(true) }}><TextField label={self ? 'Имя профиля' : 'Имя в семье'} value={name} maxLength={64} required disabled={!canEdit || state === 'saving'} onChange={e => { setName(e.target.value); setSaved(false) }} />
      {owner ? <InlineNotice>Владелец семьи. Эту роль изменить нельзя.</InlineNotice> : <Field label="Доступ"><select value={access} disabled={!canManage || state === 'saving'} onChange={e => { setAccess(e.target.value as 'full' | 'viewer'); setSaved(false) }}><option value="full">Полный доступ</option><option value="viewer">Просмотр</option></select></Field>}
      <Typography variant="meta">{access === 'viewer' ? 'Может смотреть воспоминания и оставлять реакции.' : 'Может добавлять и изменять воспоминания, приглашать близких.'}</Typography>
      <Typography variant="meta">В семье с 12 сентября 2023</Typography>
      {['error', 'conflict', 'avatar-error', 'remove-error'].includes(state) && <InlineNotice error>{state === 'conflict' ? 'Профиль изменился. Обновите данные перед сохранением.' : state === 'avatar-error' ? 'Не удалось загрузить фото. Выберите его ещё раз.' : state === 'remove-error' ? 'Не удалось удалить участника. Доступ остался прежним.' : 'Не удалось сохранить изменения.'}</InlineNotice>}
      {state === 'conflict' && <Button tone="secondary" onPress={() => actions.go('member:edit')}>Обновить данные</Button>}
      {state === 'saving' || state === 'avatar-upload' ? <LoadingState label={state === 'avatar-upload' ? 'Загружаем фотографию…' : 'Сохраняем профиль…'} /> : null}
      {saved && <InlineNotice>Изменения сохранены</InlineNotice>}
      {canEdit && <Button type="submit" disabled={state === 'saving' || state === 'conflict'}>Сохранить изменения</Button>}
    </form>
    {canManage && <Button tone="danger" onPress={() => actions.open('remove-member')}>Удалить из семьи</Button>}
    {state === 'remove' && <Typography variant="meta">Удаление требует подтверждения. Откройте «Удалить из семьи».</Typography>}
    {state === 'avatar-remove' && <Typography variant="meta">После удаления вместо фотографии будет первая буква имени.</Typography>}
  </PageContent></>
}
