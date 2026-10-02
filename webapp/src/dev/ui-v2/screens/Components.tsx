import { Avatar, Badge, Button, IconButton } from '../primitives/controls'
import { Typography, PersonName } from '../primitives/Typography'
import { TextField } from '../primitives/forms'
import { Divider } from '../primitives/layout'
import { FamilyHero } from '../components/FamilyHero'
import { MemoryCard, ReactionPicker } from '../components/MemoryCard'
import { InlineNotice, LoadingState, EmptyState } from '../components/Feedback'
import { BottomTabs } from '../components/BottomTabs'
import { CoverPreview } from './Settings'
import { PageContent } from './common'
import type { ScreenProps } from './types'
import { memories as initialMemories } from '../fixtures/data'
export function Components(props: ScreenProps) {
  const { entry, family, role, memories, actions } = props
  const memory = memories[0] ?? initialMemories[0]
  if (entry.screen === 'themes') return <><FamilyHero model={family} onAllFamilies={() => actions.go('families:multiple')} onOpenChild={() => actions.go('child:complete')} /><PageContent><Typography as="h1" variant="title">Шапка профиля</Typography><CoverPreview family={family} /><Button onPress={() => actions.go('feed:photo')}>Посмотреть ленту</Button><Button tone="secondary" onPress={() => actions.go('family:' + role)}>Посмотреть семью</Button></PageContent></>
  return <PageContent><Typography as="h1" variant="title">Одна система. Одна история.</Typography><Typography variant="meta">{entry.state}</Typography>
    {['family-hero', 'primitives'].includes(entry.state) && <FamilyHero model={family} onAllFamilies={() => actions.go('families:multiple')} onOpenChild={() => actions.go('child:complete')} />}
    {entry.state === 'typography' && <><Typography as="h1" variant="display">История Лилии</Typography><Typography as="h2" variant="title">Самые дорогие моменты</Typography><Typography as="h3" variant="section">Близкие рядом</Typography><PersonName>Бабушка</PersonName><Typography>Сохранить воспоминание — значит однажды вернуться в этот день.</Typography><Typography variant="meta">2 октября · 10:24</Typography><Typography variant="caption">Только для близких</Typography></>}
    {entry.state === 'buttons' || entry.state === 'primitives' ? <><Button onPress={() => actions.onNotice('Изменения сохранены')}>Сохранить</Button><Button tone="secondary" onPress={() => actions.open('add')}>Добавить момент</Button><Button tone="quiet" onPress={() => actions.onNotice('Отмена')}>Отмена</Button><Button tone="danger" onPress={() => actions.open('delete')}>Удалить</Button><Button disabled>Сохраняем…</Button><IconButton name="gear" label="Настройки" onPress={() => actions.go('settings:menu')} /><Avatar name="Лилия" src={family.avatar} /><Badge>Новое</Badge><Divider /></> : null}
    {entry.state === 'forms' && <><TextField label="Имя в семье" defaultValue="Бабушка" /><TextField label="Дата воспоминания" type="date" defaultValue="2026-10-02" /></>}
    {entry.state === 'feedback' && <><InlineNotice>Воспоминание сохранено</InlineNotice><InlineNotice error>Не удалось сохранить. Попробуйте снова.</InlineNotice><LoadingState /><EmptyState title="Всё начинается с момента" body="Сохраните то, что хочется запомнить." /></>}
    {entry.state === 'memory-card' && <MemoryCard model={memory} onOpen={() => actions.open('viewer')} onActions={() => actions.open('memory-actions')} onReactions={() => actions.open('reactions')} onReact={emoji => actions.onReact(memory.id, emoji)} />}
    {entry.state === 'navigation' && <BottomTabs active="feed" role={role} onFeed={() => actions.go('feed:all')} onFamily={() => actions.go('family:' + role)} onAdd={() => actions.open('add')} />}
    {entry.state === 'overlays' && <><Button onPress={() => actions.open('add')}>Открыть sheet</Button><Button tone="secondary" onPress={() => actions.open('delete')}>Открыть диалог</Button><ReactionPicker onSelect={emoji => actions.onNotice('Реакция ' + emoji)} /></>}
  </PageContent>
}
