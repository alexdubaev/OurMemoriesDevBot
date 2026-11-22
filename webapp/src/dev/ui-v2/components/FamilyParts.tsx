import type { ChannelStatusModel, PersonModel } from '../fixtures/models'
import { Avatar, Badge, Button, Icon, Pressable } from '../primitives/controls'
import { PersonName, Typography } from '../primitives/Typography'
import { ErrorState, LoadingState } from './Feedback'
export function MemberRow({ person, onOpen }: { person: PersonModel; onOpen: () => void }) {
  return <Pressable className="v2-member-row" onPress={onOpen}><Avatar name={person.name} src={person.avatar} /><span className="v2-stack v2-grow"><PersonName>{person.name}</PersonName><Typography as="span" variant="meta">{person.subtitle}</Typography></span>{person.owner && <Badge>Владелец</Badge>}<Icon name="chevron" size={20} /></Pressable>
}
export function FamilyChannelCard({ model, onRetry }: { model: ChannelStatusModel; onRetry: () => void }) {
  const descriptions: Record<string, [string, string]> = {
    unconfigured: ['Канал пока не подключён', model.canManage ? 'Добавьте memoLy-бота администратором семейного канала MAX.' : 'Подключить канал может участник с правами управления.'],
    connected: [model.title, 'Подключён · новые моменты из семейного канала попадают в альбом.'],
    disconnected: ['Связь с каналом потеряна', 'Бот удалён из канала. Верните его, чтобы сохранять новые моменты.'],
    'permission-problem': ['Нужны права администратора', 'Верните боту права в семейном канале MAX.'],
  }
  if (model.state === 'loading') return <LoadingState label="Загружаем состояние канала…" />
  if (model.state === 'error') return <ErrorState title="Не удалось проверить канал" onRetry={onRetry} />
  const [title, body] = descriptions[model.state] ?? descriptions.unconfigured
  return <section className="v2-channel"><Typography as="h2" variant="section">Семейный канал MAX</Typography><Badge>{model.state === 'connected' ? 'Подключён' : 'Состояние связи'}</Badge><Typography variant="person">{title}</Typography><Typography variant="meta">{body}</Typography>{model.canManage && model.state !== 'connected' && <Button tone="secondary" onPress={onRetry}>Проверить подключение</Button>}</section>
}
