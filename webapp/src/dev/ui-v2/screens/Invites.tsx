import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Icon } from '../primitives/controls'
import { Field, TextField } from '../primitives/forms'
import { Typography } from '../primitives/Typography'
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../components/Feedback'
import { MemoLyLogo } from '../components/FamilyHero'
import { demoInvite } from '../fixtures/data'
import { PageContent, TopBar } from './common'
import type { ScreenProps } from './types'
export function IncomingInvite({ entry, role, actions }: ScreenProps) {
  const [state, setState] = useState(entry.state)
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(pending.current), [])
  function join() {
    if (state === 'joining' || state === 'loading') return
    setState('joining')
    pending.current = setTimeout(() => setState('success'), 650)
  }
  const issues: Record<string, [string, string]> = {
    expired: ['Ссылка устарела', 'Попросите близкого создать для вас новое приглашение.'],
    revoked: ['Приглашение отозвано', 'Эта ссылка больше не действует. Попросите новую у семьи.'],
    used: ['Приглашение уже использовано', 'Каждая ссылка предназначена для одного вступления. Попросите новую ссылку.'],
    'already-member': ['Вы уже в этой семье', 'Ваш семейный альбом ждёт вас.'],
    'other-family': ['Вы уже в семье', 'Проверьте приглашение и откройте список своих семей.'],
    invalid: ['Приглашение недоступно', 'Проверьте, что ссылка скопирована полностью, или попросите новую.'],
  }
  return <PageContent><MemoLyLogo /><div className="v2-invite-intro"><span className="v2-state-mark"><Icon name="family" size={32} /></span>
    <Typography as="h1" variant="title">{issues[state]?.[0] ?? (state === 'success' ? 'Теперь вы в семье' : 'Вас ждут в семье')}</Typography>
    <Typography>{issues[state]?.[1] ?? (state === 'success' ? 'Вы получили доступ к семейному альбому. Самые дорогие моменты теперь ближе.' : 'Мама приглашает вас в альбом «История Лилии». Здесь будет всё, чем хочется делиться с близкими.')}</Typography>
    {!issues[state] && state !== 'success' && <><Badge>{role === 'viewer' ? 'Просмотр' : 'Полный доступ'}</Badge><Typography variant="meta">{role === 'viewer' ? 'Вы сможете смотреть воспоминания и оставлять реакции.' : 'Вы сможете смотреть, добавлять и изменять воспоминания.'}</Typography><Typography variant="meta">Ссылка действует до {demoInvite.expires}</Typography><div className="v2-privacy-line"><Icon name="lock" size={20} /><Typography as="span" variant="meta">Семейные фото станут доступны после вступления</Typography></div></>}
    {state === 'loading' || state === 'joining' ? <LoadingState label={state === 'joining' ? 'Присоединяемся к семье…' : 'Проверяем приглашение…'} /> : null}
    {state === 'error' && <InlineNotice error>Не удалось присоединиться. Проверьте соединение и повторите.</InlineNotice>}
    {issues[state] ? <Button tone="secondary" onPress={() => actions.go(state === 'already-member' ? 'feed:all' : 'families:multiple')}>{state === 'already-member' ? 'Открыть альбом' : 'Мои семьи'}</Button> : <Button disabled={state === 'joining' || state === 'loading'} onPress={() => state === 'success' ? actions.go('feed:all') : join()}>{state === 'success' ? 'Открыть альбом' : 'Присоединиться'}</Button>}
  </div></PageContent>
}
export function InviteCreate({ entry, role, actions }: ScreenProps) {
  const state = entry.state
  const [name, setName] = useState(state === 'friend' ? 'Подруга' : 'Бабушка')
  const [access, setAccess] = useState(state === 'full' ? 'full' : 'viewer')
  const [ready, setReady] = useState(['created', 'copied', 'copy-error', 'shared'].includes(state))
  const [notice, setNotice] = useState(state === 'copied' ? 'Ссылка скопирована' : state === 'shared' ? 'Приглашение готово к отправке' : '')
  if (role === 'viewer') return <PageContent><EmptyState title="Приглашает ваша семья" body="Создавать приглашения могут владелец и участники с полным доступом." action="К семье" onPress={() => actions.go('family:viewer')} /></PageContent>
  return <><TopBar title={ready ? 'Приглашение готово' : 'Пригласить близкого'} onBack={() => actions.go('family:' + role)} /><PageContent>{ready ? <>
    <Typography as="h1" variant="title">Семья становится ближе</Typography><Typography>Отправьте ссылку лично тому, кого ждёте в альбоме.</Typography><section className="v2-invite-card"><Typography variant="person">{name}</Typography><Badge>{access === 'full' ? 'Полный доступ' : 'Просмотр'}</Badge><Typography variant="meta">До {demoInvite.expires}</Typography><Typography className="v2-demo-link" variant="meta">{demoInvite.url}</Typography></section>
    {state === 'copy-error' && <InlineNotice error>Не удалось скопировать ссылку. Попробуйте ещё раз.</InlineNotice>}{notice && <InlineNotice>{notice}</InlineNotice>}
    <Button onPress={() => { setNotice('Ссылка скопирована'); actions.onNotice('Ссылка скопирована') }}>Копировать ссылку</Button><Button tone="secondary" onPress={() => { setNotice('Приглашение готово к отправке'); actions.onNotice('Приглашение готово к отправке') }}>Поделиться приглашением</Button><Button tone="quiet" onPress={() => actions.go('family:' + role)}>Готово</Button>
  </> : <form className="v2-stack" onSubmit={e => { e.preventDefault(); setReady(true) }}><Typography>Одно приглашение — для одного близкого. Его доступ можно изменить позже.</Typography><TextField label="Как вы называете близкого" value={name} maxLength={64} onChange={e => setName(e.target.value)} /><Field label="Доступ к альбому"><select value={access} onChange={e => setAccess(e.target.value)}><option value="viewer">Просмотр</option><option value="full">Полный доступ</option></select></Field><Typography variant="meta">{access === 'viewer' ? 'Смотреть воспоминания и оставлять реакции.' : 'Добавлять и изменять воспоминания, приглашать близких.'}</Typography>{state === 'error' && <InlineNotice error>Не удалось создать приглашение. Попробуйте снова.</InlineNotice>}{state === 'creating' && <LoadingState label="Создаём приглашение…" />}<Button type="submit" disabled={state === 'creating'}>Создать приглашение</Button></form>}</PageContent></>
}
export function Invites({ entry, role, actions }: ScreenProps) {
  const state = entry.state
  if (role === 'viewer') return <PageContent><EmptyState title="Управление приглашениями" body="Доступно участникам с полным доступом." action="К семье" onPress={() => actions.go('family:viewer')} /></PageContent>
  return <><TopBar title="Приглашения" onBack={() => actions.go('family:' + role)} /><PageContent>
    {state === 'empty' || state === 'revoked' ? <EmptyState title={state === 'revoked' ? 'Приглашение отозвано' : 'Нет активных приглашений'} body="Созданные ссылки появятся здесь, пока близкий не присоединится." action="Пригласить близкого" onPress={() => actions.go('invite-create:relative')} /> : state === 'error' ? <ErrorState title="Не удалось отозвать приглашение" onRetry={() => actions.go('invites:active')} /> : <section className="v2-invite-card"><Typography variant="person">{demoInvite.name}</Typography><Typography variant="meta">Просмотр · до {demoInvite.expires}</Typography><Button tone="quiet" disabled={state === 'revoking'} onPress={() => actions.open('revoke-invite')}>{state === 'revoking' ? 'Отзываем…' : 'Отозвать приглашение'}</Button><Typography variant="caption">После отзыва эта ссылка перестанет работать.</Typography></section>}
  </PageContent></>
}
