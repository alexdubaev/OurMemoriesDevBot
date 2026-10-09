import { FamilyHero } from '../components/FamilyHero'
import { childAge, childBirthday } from '../fixtures/child'
import { FamilyChannelCard, MemberRow } from '../components/FamilyParts'
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../components/Feedback'
import { Avatar, Badge, Button, Icon, Pressable } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import { PageContent, TopBar } from './common'
import type { ScreenProps } from './types'
export function Family({ entry, family, role, people, actions }: ScreenProps) {
  const state = entry.state
  const canInvite = role !== 'viewer' && state !== 'incomplete'
  return <><FamilyHero model={family} onAllFamilies={() => actions.go('families:multiple')} onOpenChild={() => actions.go('child:complete')} onSettings={() => actions.go('settings:menu')} />
    <PageContent><div className="v2-section-heading"><Typography as="h1" variant="section">Наша семья</Typography><Typography as="span" variant="meta">{people.length} близких</Typography></div>
      {state === 'loading' ? <LoadingState label="Загружаем участников…" /> : state === 'error' ? <ErrorState title="Не удалось обновить семью" onRetry={() => actions.go('family:owner')} /> : <>
        {state === 'incomplete' && <InlineNotice>Завершите профиль ребёнка, чтобы пригласить близких.</InlineNotice>}
        <div className="v2-member-list">{people.map(person => <MemberRow key={person.id} person={person} onOpen={() => actions.go('member:' + (person.owner ? 'owner' : person.role), person.id)} />)}</div>
        {canInvite && <Button onPress={() => actions.go('invite-create:relative')}>Пригласить близкого</Button>}
        <Typography className="v2-footnote" variant="meta">{role === 'viewer' ? 'Вы можете смотреть воспоминания и оставлять реакции.' : 'Это ваш круг близких. Снаружи семейный альбом не виден.'}</Typography>
        <FamilyChannelCard model={{ state: 'connected', title: 'Моменты нашей семьи', canManage: role !== 'viewer' }} onRetry={() => actions.go('channel:connected')} />
        <Pressable className="v2-settings-row" onPress={() => actions.go('archive:ready')}><Icon name="family" /><Typography as="span">Семейный архив</Typography><Typography as="span" variant="meta">324 МБ</Typography><Icon name="chevron" size={20} /></Pressable>
        {state === 'usage-error' && <InlineNotice error>Не удалось получить объём архива. Воспоминания доступны.</InlineNotice>}
        {role === 'owner' && <Button tone="quiet" onPress={() => actions.go('settings:family')}>Настройки семьи</Button>}
        {role !== 'owner' && <Button tone="quiet" onPress={() => actions.go('family:leave')}>Выйти из семьи</Button>}
      </>}
    </PageContent>
    {state.startsWith('leave') && <PageContent>{role === 'owner' ? <InlineNotice>Владелец семьи не может выйти из своего альбома.</InlineNotice> : <><Typography as="h2" variant="title">Выйти из семьи?</Typography><Typography>Вы потеряете доступ к приватным воспоминаниям этой семьи.</Typography>{state === 'leave-error' && <InlineNotice error>Не удалось выйти. Ваш доступ остался прежним.</InlineNotice>}<Button tone="danger" disabled={state === 'leave-busy'} onPress={() => { actions.onNotice('Вы вышли из demo-семьи'); actions.go('families:one') }}>{state === 'leave-busy' ? 'Выходим…' : 'Выйти из семьи'}</Button><Button tone="secondary" onPress={() => actions.go('family:full')}>Отмена</Button></>}</PageContent>}
  </>
}
export function Child({ entry, family, role, actions }: ScreenProps) {
  return <><TopBar title="Профиль ребёнка" onBack={() => actions.go('family:' + role)} /><PageContent><div className="v2-profile-intro"><Avatar name={family.name} src={entry.state === 'avatar-error' || entry.state === 'avatar-loading' ? undefined : family.avatar} large /><Typography as="h1" variant="title">{family.name}</Typography><Badge>Главный герой нашей истории</Badge></div>
    {entry.state === 'incomplete' ? <EmptyState title={'Добавим немного о ' + family.name} body="Фото и дата рождения помогут сделать альбом личным." action={role === 'owner' ? 'Заполнить профиль' : undefined} onPress={() => actions.go('setup:edit')} /> : <section className="v2-profile-facts"><div><Typography variant="meta">День рождения</Typography><Typography>{childBirthday(entry.state === 'no-date' ? undefined : family.birthDate)}</Typography></div><div><Typography variant="meta">Возраст</Typography><Typography>{childAge(entry.state === 'no-date' ? undefined : family.birthDate)}</Typography></div></section>}
    {entry.state === 'avatar-loading' && <LoadingState label="Загружаем фотографию…" />}{entry.state === 'avatar-error' && <InlineNotice error>Не удалось загрузить фотографию. Профиль доступен.</InlineNotice>}
    {role === 'owner' && <><Button tone="secondary" onPress={() => actions.go('setup:edit')}>Редактировать профиль</Button><Button tone="quiet" onPress={() => actions.go('setup:avatar')}>Изменить фотографию</Button></>}
  </PageContent></>
}
