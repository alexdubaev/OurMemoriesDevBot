import { useState } from 'react'
import { FamilyChannelCard } from '../components/FamilyParts'
import { Button, Badge, Icon, Pressable } from '../primitives/controls'
import { TextField, Field } from '../primitives/forms'
import { Typography } from '../primitives/Typography'
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../components/Feedback'
import { PageContent, TopBar } from './common'
import type { ScreenProps } from './types'
export function CoverPreview({ family }: Pick<ScreenProps, 'family'>) {
  return <div className="v2-cover-preview">{family.cover ? <img src={family.cover} alt="Обложка профиля" /> : <Typography variant="meta">Без иллюстрации</Typography>}</div>
}
export function Settings({ entry, family, role, actions }: ScreenProps) {
  const state = entry.state
  const [name, setName] = useState(family.familyName)
  const [zone, setZone] = useState(family.timezone ?? 'Europe/Moscow')
  const [saved, setSaved] = useState(state === 'saved')
  const menu = [['appearance', 'Обложка профиля', 'Иллюстрация вашей семейной истории'], ['privacy', 'Приватность и помощь', 'Кто видит ваши воспоминания'], ['about', 'О memoLy', 'Личный семейный альбом'], ['install-entry', 'Установить memoLy', 'Всегда под рукой']] as const
  return <><TopBar title={state === 'appearance' ? 'Обложка профиля' : state === 'family' ? 'Настройки семьи' : 'Настройки'} onBack={() => actions.go('family:' + role)} /><PageContent>
    {state === 'menu' ? <>{menu.map(([key, title, copy]) => <Pressable className="v2-settings-row" key={key} onPress={() => actions.go('settings:' + key)}><span className="v2-stack v2-grow"><Typography as="span" variant="person">{title}</Typography><Typography as="span" variant="meta">{copy}</Typography></span><Icon name="chevron" size={20} /></Pressable>)}<Button tone="secondary" onPress={() => actions.go('member:self')}>Мой профиль</Button>{role === 'owner' && <Button tone="quiet" onPress={() => actions.go('settings:family')}>Настройки семьи</Button>}<Button tone="quiet" onPress={() => actions.go('archive:ready')}>Семейный архив</Button>{role !== 'viewer' && <Button tone="quiet" onPress={() => actions.go('invites:active')}>Активные приглашения</Button>}</> :
      state === 'appearance' ? <><CoverPreview family={family} /></> :
      state === 'privacy' || state === 'about' ? <><Typography as="h1" variant="title">{state === 'privacy' ? 'Только для ваших близких' : 'Моменты, к которым хочется возвращаться'}</Typography><Typography>memoLy — приватный семейный альбом. Фотографии, видео, голосовые и слова доступны только участникам вашей семьи.</Typography><Typography>Просмотр позволяет открывать воспоминания и оставлять реакции. Полный доступ позволяет добавлять и изменять записи.</Typography><Typography>Вы сами выбираете, кого пригласить. Публичной ленты и комментариев здесь нет.</Typography></> :
      state === 'install-entry' ? <EmptyState title="Ваш альбом под рукой" body="Добавьте memoLy на главный экран, чтобы открывать его одним касанием." action="Как установить" onPress={() => actions.go('install:available')} /> :
      role !== 'owner' ? <InlineNotice>Настройки семьи меняет владелец.</InlineNotice> : <form className="v2-stack" onSubmit={e => { e.preventDefault(); actions.onSaveFamily(name.trim(), zone); setSaved(true) }}><TextField label="Название семьи" value={name} required maxLength={80} onChange={e => { setName(e.target.value); setSaved(false) }} /><Field label="Часовой пояс"><select value={zone} onChange={e => setZone(e.target.value)}>{['Europe/Moscow', 'Europe/Riga', 'Europe/Amsterdam', 'UTC'].map(value => <option key={value}>{value}</option>)}</select></Field><Typography variant="meta">По этому часовому поясу считаются даты и возраст ребёнка.</Typography>{state === 'error' && <InlineNotice error>Не удалось сохранить настройки. Данные остались в форме.</InlineNotice>}{state === 'saving' && <LoadingState label="Сохраняем настройки…" />}{saved && <InlineNotice>Настройки семьи сохранены</InlineNotice>}<Button type="submit" disabled={state === 'saving'}>Сохранить</Button></form>}
  </PageContent></>
}
export function Archive({ entry, actions }: ScreenProps) {
  return <><TopBar title="Семейный архив" onBack={() => actions.go('settings:menu')} /><PageContent>{entry.state === 'loading' ? <LoadingState label="Загружаем объём архива…" /> : entry.state === 'error' ? <ErrorState title="Не удалось загрузить объём архива" body="Сами воспоминания доступны. Не удалось получить только информацию о занятом месте." onRetry={() => actions.go('archive:ready')} /> : <><Badge>Приватное хранилище</Badge><Typography as="h1" variant="display">324 МБ</Typography><Typography>{entry.state === 'no-quota' ? 'Лимит не указан' : 'из 2 ГБ — ещё много места для вашей истории'}</Typography>{entry.state !== 'no-quota' && <progress aria-label="Использовано место в архиве" value={16} max={100} />}<Typography variant="meta">Фото, голос и подготовленные медиа доступны только участникам семьи.</Typography></>}</PageContent></>
}
export function Channel({ entry, role, actions }: ScreenProps) {
  return <><TopBar title="Семейный канал" onBack={() => actions.go('family:' + role)} /><PageContent><FamilyChannelCard model={{ state: entry.state === 'management' || entry.state === 'no-management' ? 'unconfigured' : entry.state, title: 'Моменты нашей семьи', canManage: role !== 'viewer' && entry.state !== 'no-management' }} onRetry={() => actions.go('channel:connected')} />{role !== 'viewer' && entry.state !== 'no-management' && <Typography variant="meta">Добавьте memoLy-бота администратором канала MAX. После этого новые фотографии и сообщения будут сохраняться в вашем альбоме.</Typography>}</PageContent></>
}
export function Install({ entry, actions }: ScreenProps) {
  const state = entry.state
  const installed = state === 'installed' || state === 'standalone'
  const unavailable = state === 'unavailable'
  const dismissed = state === 'dismissed'
  return <><TopBar title="Альбом под рукой" onBack={() => actions.go('settings:menu')} /><PageContent><span className="v2-state-mark"><Icon name={installed ? 'check' : 'photo'} size={32} /></span><Typography as="h1" variant="title">{installed ? 'memoLy уже на главном экране' : dismissed ? 'Можно установить позже' : state === 'ios-browser' ? 'Откройте в браузере' : 'Один шаг до ваших воспоминаний'}</Typography><Typography>{installed ? 'Открывайте семейный альбом одним касанием.' : dismissed ? 'Предложение скрыто. Вернуться к установке можно в настройках.' : state === 'ios-browser' ? 'Откройте memoLy в Safari и выберите «Поделиться» → «На экран Домой».' : unavailable ? 'Автоматическая установка сейчас недоступна. Откройте меню браузера и выберите «Добавить на главный экран».' : 'Добавьте memoLy на главный экран. Ваши близкие будут рядом, когда захочется открыть альбом.'}</Typography>
    {state === 'error' || state === 'cancelled' ? <InlineNotice error={state === 'error'}>{state === 'error' ? 'Не удалось открыть установку. Попробуйте снова.' : 'Установка отменена. Можно попробовать позже.'}</InlineNotice> : null}
    {installed || dismissed ? <Button onPress={() => actions.go('feed:all')}>Открыть альбом</Button> : <><Button onPress={() => actions.go(state === 'ios-browser' || unavailable ? 'first-run:browser-login' : 'install:installed')}>{state === 'ios-browser' || unavailable ? 'Открыть в браузере' : 'Установить memoLy'}</Button><Button tone="quiet" onPress={() => actions.go('install:dismissed')}>Позже</Button></>}
  </PageContent></>
}
