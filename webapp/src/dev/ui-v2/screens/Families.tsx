import { MemoLyLogo } from '../components/FamilyHero'
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../components/Feedback'
import { Avatar, Badge, Button, Icon, Pressable } from '../primitives/controls'
import { PersonName, Typography } from '../primitives/Typography'
import { PageContent } from './common'
import type { ScreenProps } from './types'
export function Families({ entry, family, actions }: ScreenProps) {
  const state = entry.state
  return <PageContent><MemoLyLogo /><header className="v2-page-intro"><Typography as="h1" variant="display">Близкие рядом.</Typography><Typography>У каждой семьи — своя история.</Typography></header>
    {state === 'loading' ? <LoadingState label="Загружаем семьи…" /> : state === 'error' ? <ErrorState title="Не удалось загрузить семьи" onRetry={() => actions.go('families:multiple')} /> : state === 'empty' ? <EmptyState title="Здесь начнётся ваша история" body="Создайте альбом для своей семьи или откройте приглашение от близких." action="Создать свою семью" onPress={() => actions.go('setup:create')} /> : <>
      {['stale', 'unread-unavailable', 'more-error', 'create-error', 'own-unavailable'].includes(state) && <InlineNotice error={state === 'create-error'}>{state === 'create-error' ? 'Не удалось создать семью. Попробуйте снова.' : state === 'more-error' ? 'Не удалось загрузить остальные семьи.' : state === 'own-unavailable' ? 'Ваша семья сейчас недоступна. Откройте другой альбом или повторите позже.' : 'Не удалось обновить счётчики. Семейные альбомы можно открыть.'}</InlineNotice>}
      {state !== 'invited' && state !== 'own-unavailable' && <section className="v2-stack"><Typography as="h2" variant="section">Моя семья</Typography><FamilyTile name={family.familyName} subtitle={state === 'needs-child' ? 'Завершить профиль ребёнка' : family.name + ' · 3 года'} role="Владелец" image={family.avatar} count={state === 'unread' || state === 'multiple' ? '5 новых' : state === 'unread-not-enabled' ? 'Счётчик пока не включён' : undefined} onOpen={() => actions.go(state === 'needs-child' ? 'setup:child-setup' : 'feed:all')} /></section>}
      {!['one', 'owner', 'needs-child', 'unread-not-enabled'].includes(state) && <section className="v2-stack"><Typography as="h2" variant="section">Семьи близких</Typography><FamilyTile name="История Миши" subtitle="Первый год, первые открытия" role="Просмотр" count="2 новых" onOpen={() => { actions.onNotice('Открыт demo-альбом семьи Миши'); actions.go('feed:landscape') }} /></section>}
      {state === 'loading-more' ? <LoadingState label="Загружаем ещё семьи…" /> : state === 'more-error' ? <Button tone="secondary" onPress={() => actions.go('families:multiple')}>Повторить загрузку</Button> : null}
      <Button tone="secondary" disabled={state === 'creating'} onPress={() => actions.go('setup:create')}>{state === 'creating' ? 'Создаём семью…' : 'Создать свою семью'}</Button>
    </>}
    <Typography className="v2-footnote" variant="meta">Личные альбомы. Только вы и ваши близкие.</Typography>
  </PageContent>
}
function FamilyTile({ name, subtitle, role, image, count, onOpen }: { name: string; subtitle: string; role: string; image?: string; count?: string; onOpen: () => void }) {
  return <Pressable className="v2-family-tile" onPress={onOpen}><Avatar name={name} src={image} large /><span className="v2-stack v2-grow"><PersonName>{name}</PersonName><Typography as="span" variant="meta">{subtitle}</Typography><Typography as="span" variant="caption">{role}</Typography>{count && <Badge>{count}</Badge>}</span><Icon name="chevron" size={20} /></Pressable>
}
