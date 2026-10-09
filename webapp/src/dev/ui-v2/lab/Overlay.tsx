import { Modal } from '../components/Modal'
import { ReactionPicker } from '../components/MemoryCard'
import { InlineNotice } from '../components/Feedback'
import { Button, Icon, Pressable } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import { Viewer } from '../screens/Viewer'
import type { MemoryCardModel } from '../fixtures/models'
import type { ScreenActions } from '../screens/types'
import type { Role } from '../states/catalog'
export function Overlay({ kind, role, model, index = 0, actions, onClose }: { kind: string; role: Role; model: MemoryCardModel; index?: number; actions: ScreenActions; onClose: () => void }) {
  const closeGo = (id: string) => { onClose(); actions.go(id) }
  if (kind === 'viewer') return <Modal title="Воспоминание" variant="viewer" onClose={onClose}><Viewer model={model} initialIndex={index} onClose={onClose} /></Modal>
  const titles: Record<string, string> = { add: 'Что сохраним сегодня?', 'voice-video': 'Голос или видео', 'voice-handoff': 'Сохраните голос близкого', 'memory-actions': 'Воспоминание', reactions: 'Как вам этот момент?', delete: 'Удалить воспоминание?', deleting: 'Удаляем воспоминание…', 'delete-error': 'Не удалось удалить', 'member-actions': 'Участник семьи', 'remove-member': 'Удалить участника?', 'revoke-invite': 'Отозвать приглашение?', 'cancel-composer': 'Выйти без сохранения?', 'invite-result': 'Приглашение готово', 'error-banner': 'Не удалось сохранить', toast: 'Момент сохранён' }
  const confirm = ['delete', 'deleting', 'delete-error', 'remove-member', 'revoke-invite', 'cancel-composer'].includes(kind)
  return <Modal title={titles[kind] ?? 'Действия'} onClose={onClose} variant={confirm ? 'dialog' : 'sheet'}>
    <div className="v2-overlay-content v2-stack">
      {kind === 'add' && (role === 'viewer' ? <Typography>Добавлять воспоминания могут участники с полным доступом.</Typography> : <><Typography variant="meta">Самое ценное часто случается между делом.</Typography><AddChoice title="Фото и видео" copy="Один момент или целая история" icon="photo" onPress={() => closeGo('composer:photo')} /><AddChoice title="Заметка" copy="Слова, которые хочется запомнить" icon="note" onPress={() => closeGo('composer:note')} /><AddChoice title="Голос или видео" copy="Живой голос. Настоящий момент." icon="voice" onPress={() => { onClose(); actions.open('voice-video') }} /></>)}
      {kind === 'voice-video' && <><AddChoice title="Выбрать видео" copy="Готовый файл с устройства" icon="video" onPress={() => closeGo('composer:video-empty')} /><AddChoice title="Отправить голос боту" copy="Голос сохраняется через бота" icon="voice" onPress={() => { onClose(); actions.open('voice-handoff') }} /></>}
      {kind === 'voice-handoff' && <><Typography>Отправьте голосовое сообщение memoLy-боту. Оно появится в семейном альбоме.</Typography><Typography variant="meta">Здесь можно сохранить готовое видео. Запись голоса остаётся в приложении бота.</Typography><Button onPress={() => { actions.onNotice('Голосовое сообщение появится в семейном альбоме'); onClose() }}>Понятно</Button></>}
      {kind === 'memory-actions' && <><Typography variant="meta">{model.author.name} · {model.date}</Typography><Button tone="secondary" onPress={() => { onClose(); actions.open('viewer', model.id) }}>Открыть воспоминание</Button>{role !== 'viewer' && <><Button tone="quiet" onPress={() => closeGo('composer:edit')}>Редактировать</Button><Button tone="danger" onPress={() => { onClose(); actions.open('delete', model.id) }}>Удалить</Button></>}</>}
      {kind === 'reactions' && <><ReactionPicker selected={model.ownReaction} onSelect={emoji => { actions.onReact(model.id, emoji); onClose() }} /><Typography variant="meta">Одна реакция от каждого. Нажмите выбранную, чтобы убрать её.</Typography></>}
      {kind === 'member-actions' && <><Button tone="secondary" onPress={() => closeGo('member:viewer')}>Открыть профиль</Button>{role === 'owner' && <Button tone="danger" onPress={() => { onClose(); actions.open('remove-member') }}>Удалить из семьи</Button>}</>}
      {confirm && <><Typography>{kind === 'cancel-composer' ? 'Несохранённые изменения будут потеряны.' : kind === 'remove-member' ? 'Участник потеряет доступ к семейному альбому. Позже его можно пригласить снова.' : kind === 'revoke-invite' ? 'Эта ссылка перестанет работать. Вступить по ней больше не получится.' : 'Этот момент исчезнет из семейного альбома для всех участников. Отменить удаление не получится.'}</Typography>
        {kind === 'delete-error' && <InlineNotice error>Воспоминание осталось в альбоме. Повторите попытку.</InlineNotice>}
        {role === 'viewer' && kind !== 'cancel-composer' ? <InlineNotice>Для этого действия нужен полный доступ.</InlineNotice> : role !== 'owner' && kind === 'remove-member' ? <InlineNotice>Участника удаляет владелец семьи.</InlineNotice> : <Button tone="danger" disabled={kind === 'deleting'} onPress={() => {
          if (kind === 'cancel-composer') closeGo('feed:all')
          else if (kind === 'revoke-invite') closeGo('invites:revoked')
          else if (kind === 'remove-member') { actions.onRemovePerson(); actions.onNotice('Участник удалён из семьи'); closeGo('family:owner') }
          else { actions.onDelete(model.id); onClose(); actions.onNotice('Воспоминание удалено') }
        }}>{kind === 'cancel-composer' ? 'Выйти без сохранения' : kind === 'revoke-invite' ? 'Отозвать' : kind === 'delete-error' ? 'Повторить удаление' : kind === 'deleting' ? 'Удаляем…' : 'Удалить'}</Button>}
        <Button tone="secondary" onPress={onClose}>{kind === 'cancel-composer' ? 'Продолжить редактирование' : 'Отмена'}</Button></>}
      {kind === 'invite-result' && <><Typography>Отправьте приглашение лично вашему близкому.</Typography><Button onPress={() => closeGo('invite-create:created')}>Открыть приглашение</Button></>}
      {kind === 'error-banner' && <><InlineNotice error>Соединение прервалось. Изменения остались на экране.</InlineNotice><Button onPress={onClose}>Повторить</Button></>}
      {kind === 'toast' && <><InlineNotice>Воспоминание сохранено в семейный альбом</InlineNotice><Button onPress={onClose}>Готово</Button></>}
    </div>
  </Modal>
}
function AddChoice({ title, copy, icon, onPress }: { title: string; copy: string; icon: 'photo' | 'note' | 'voice' | 'video'; onPress: () => void }) {
  return <Pressable className="v2-add-choice" onPress={onPress}><span className="v2-add-choice-icon"><Icon name={icon} size={32} /></span><span className="v2-stack v2-grow"><Typography as="span" variant="section">{title}</Typography><Typography as="span" variant="meta">{copy}</Typography></span><Icon name="chevron" size={20} /></Pressable>
}
