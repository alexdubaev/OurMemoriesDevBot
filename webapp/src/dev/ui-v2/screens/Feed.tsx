/* eslint-disable react-refresh/only-export-components -- fixture model derivation is shared with the Lab viewer; no production adapter. */
import { FamilyHero } from '../components/FamilyHero'
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../components/Feedback'
import { MemoryCard } from '../components/MemoryCard'
import { memories as original, photos } from '../fixtures/data'
import type { MemoryCardModel } from '../fixtures/models'
import { Button } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import type { ScreenProps } from './types'
export function selectedMemory(state: string, current: MemoryCardModel[]): MemoryCardModel {
  const source = current.find(m => m.id === (state.includes('note') ? 'note' : state.startsWith('voice') ? 'voice' : ['mixed', 'multi-photo'].includes(state) ? 'mixed' : state.includes('video') || ['processing', 'unavailable', 'readiness-unknown', 'readiness-checking', 'readiness-error'].includes(state) ? 'video' : 'photo')) ?? original[0]
  const model = { ...source, media: source.media.map(m => ({ ...m })), reactions: source.reactions.map(r => ({ ...r })) }
  if (state === 'landscape') model.media = [{ kind: 'photo', src: photos.family, alt: 'Семья на прогулке', orientation: 'landscape' }]
  if (state === 'multi-photo') model.media = model.media.map(m => ({ ...m, kind: 'photo' }))
  if (state === 'private-video' || state === 'telegram-video') model.media = model.media.map(m => ({ ...m, provider: state === 'private-video' ? 'Приватное видео' : 'Telegram' }))
  if (['processing', 'unavailable', 'readiness-unknown', 'readiness-checking', 'readiness-error', 'media-error'].includes(state)) {
    const status = state === 'readiness-unknown' ? 'unknown' : state === 'readiness-checking' ? 'checking' : state === 'readiness-error' ? 'check-error' : state === 'media-error' ? 'error' : state as 'processing' | 'unavailable'
    model.media = [{ ...original[4].media[0], status }]
  }
  if (state === 'long-note') model.body = Array(4).fill(original[2].body).join('\n\n')
  return model
}
export function Feed({ entry, family, memories, actions, role }: ScreenProps) {
  const state = entry.state
  const rows = state === 'all' || ['unread', 'new-memories', 'loading-more', 'more-error', 'unread-unavailable'].includes(state) ? memories : [selectedMemory(state, memories)]
  return <>
    <FamilyHero model={family} onAllFamilies={() => actions.go('families:multiple')} onOpenChild={() => actions.go('child:complete')} />
    <div className="v2-feed-heading"><Typography as="h1" variant="section">Наши воспоминания</Typography><Button tone="quiet" onPress={() => actions.go(state === 'unread' ? 'feed:all' : 'feed:unread')}>{state === 'unread' ? 'Все' : 'Новые · 5'}</Button></div>
    {state === 'new-memories' && <div className="v2-feed-notice"><Button tone="secondary" onPress={() => actions.go('feed:all')}>Появились новые воспоминания ↑</Button></div>}
    {state === 'unread-unavailable' && <InlineNotice>Счётчик временно недоступен. Все воспоминания доступны.</InlineNotice>}
    {state === 'loading' ? <LoadingState /> : state === 'error' ? <ErrorState title="Не удалось загрузить воспоминания" onRetry={() => actions.go('feed:all')} /> : state === 'access-lost' ? <ErrorState title="Доступ к семье изменился" body="Вернитесь к списку семей. Если это ошибка, попросите владельца проверить ваш доступ." onRetry={() => actions.go('families:multiple')} /> : state === 'empty' || state === 'unread-empty' || !rows.length ? <EmptyState title={state === 'unread-empty' ? 'Вы всё посмотрели' : 'Первый момент — за вами'} body={state === 'unread-empty' ? 'Новые воспоминания появятся здесь.' : 'Сохраните фото, слова или голос. Однажды этот день станет дорогим воспоминанием.'} action={state === 'unread-empty' ? 'Все воспоминания' : role === 'viewer' ? 'Открыть семью' : 'Добавить воспоминание'} onPress={() => state === 'unread-empty' ? actions.go('feed:all') : role === 'viewer' ? actions.go('family:viewer') : actions.open('add')} /> :
      <div className="v2-feed-list"><Typography className="v2-date-label" variant="meta">{state === 'unread' ? 'Новые для вас' : 'Октябрь 2026'}</Typography>{rows.map(model => <MemoryCard key={model.id} model={model} onOpen={i => actions.open('viewer', model.id, i)} onActions={() => actions.open('memory-actions', model.id)} onReactions={() => actions.open('reactions', model.id)} onReact={emoji => actions.onReact(model.id, emoji)} voicePlaying={state === 'voice-playing'} voiceError={state === 'voice-error'} reactionError={state === 'reaction-error'} />)}{state === 'loading-more' && <LoadingState label="Загружаем прошлые моменты…" />}{state === 'more-error' && <ErrorState title="Не удалось загрузить ещё" onRetry={() => actions.go('feed:all')} />}</div>}
  </>
}
