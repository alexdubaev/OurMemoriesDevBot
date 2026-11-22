import { useEffect, useRef, useState } from 'react'
import { Button, IconButton, Pressable } from '../primitives/controls'
import { Field, TextField } from '../primitives/forms'
import { Typography } from '../primitives/Typography'
import { EmptyState, InlineNotice, LoadingState } from '../components/Feedback'
import { photos } from '../fixtures/data'
import type { MediaModel } from '../fixtures/models'
import { TopBar, PageContent } from './common'
import type { ScreenProps } from './types'

function useLocalSave(initial: string) {
  const [status, setStatus] = useState(initial)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  function save(callback: () => void) {
    if (['saving', 'upload', 'publishing'].includes(status)) return
    setStatus('saving')
    timers.current.push(setTimeout(() => { callback(); setStatus('success') }, 650))
  }
  return { status, setStatus, save }
}
export function Setup({ entry, family, actions }: ScreenProps) {
  const state = entry.state
  const { status, setStatus, save } = useLocalSave(state)
  const [name, setName] = useState(state === 'incomplete' || state === 'child-setup' ? '' : family.name)
  const [familyName, setFamilyName] = useState(family.familyName)
  const [birthday, setBirthday] = useState(family.birthDate ?? '2023-09-12')
  const [sex, setSex] = useState(family.sex ?? 'female')
  const [avatar, setAvatar] = useState(state === 'incomplete' ? false : true)
  const [crop, setCrop] = useState(state === 'crop')
  const [zoom, setZoom] = useState(1)
  if (status === 'success') return <PageContent><EmptyState title="Профиль сохранён" body={'Профиль ' + name + ' сохранён в demo-семье.'} action={state === 'edit' || state === 'avatar' || state === 'crop' ? 'Открыть профиль' : 'Открыть альбом'} onPress={() => actions.go(state === 'edit' || state === 'avatar' || state === 'crop' ? 'child:complete' : 'feed:empty')} /></PageContent>
  return <><TopBar title={state === 'create' ? 'Создать свою семью' : state === 'avatar' || state === 'crop' ? 'Фотография ребёнка' : state === 'edit' ? 'Редактировать профиль' : 'Познакомимся с ребёнком'} onBack={() => actions.open('cancel-composer')} /><PageContent>
    <Typography>У этой истории есть главное имя. Остальное вы сможете изменить позже.</Typography>
    <form className="v2-stack" onSubmit={e => { e.preventDefault(); if (!name.trim() || !avatar) { setStatus('validation'); return }; save(() => { actions.onSaveChild(name.trim(), birthday, sex, photos.portrait); if (state === 'create') actions.onSaveFamily(familyName.trim(), family.timezone ?? 'Europe/Moscow') }) }}>
      {state === 'create' && <TextField label="Название семьи" value={familyName} maxLength={80} required onChange={e => setFamilyName(e.target.value)} />}
      <Pressable className="v2-avatar-editor" onPress={() => { setAvatar(true); setCrop(true) }} aria-label="Выбрать фотографию ребёнка">{avatar ? <img src={photos.portrait} alt="Синтетическое фото ребёнка" /> : <Typography>Добавить фотографию</Typography>}</Pressable>
      <Button tone="quiet" onPress={() => { setAvatar(true); setCrop(true) }}>Выбрать фотографию</Button>
      {crop && <section className="v2-crop"><Typography as="h2" variant="section">Выберите кадр</Typography><div className="v2-crop-preview"><img src={photos.portrait} alt="Предпросмотр аватара" style={{ transform: 'scale(' + zoom + ')' }} /></div><Field label="Масштаб фото"><input type="range" min={1} max={2} step={0.1} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></Field><Button tone="secondary" onPress={() => setCrop(false)}>Использовать этот кадр</Button></section>}
      <TextField label="Имя ребёнка" value={name} required maxLength={64} onChange={e => setName(e.target.value)} />
      <TextField label="Дата рождения" type="date" value={birthday} max="2026-10-02" required onChange={e => setBirthday(e.target.value)} />
      <Field label="Пол"><select value={sex} onChange={e => setSex(e.target.value)}><option value="female">Девочка</option><option value="male">Мальчик</option></select></Field>
      {status === 'validation' && <InlineNotice error>Добавьте фотографию и имя ребёнка, проверьте дату рождения.</InlineNotice>}
      {status === 'error' && <InlineNotice error>Не удалось сохранить профиль. Данные остались в форме.</InlineNotice>}
      {status === 'saving' && <LoadingState label="Сохраняем профиль…" />}
      <Button type="submit" disabled={status === 'saving'}>{status === 'saving' ? 'Сохраняем…' : 'Сохранить профиль'}</Button>
      <Button tone="quiet" onPress={() => actions.open('cancel-composer')}>Отмена</Button>
    </form>
    {state === 'cancel' && <InlineNotice>Перед выходом подтвердите удаление несохранённых изменений.</InlineNotice>}
  </PageContent></>
}
export function Composer({ entry, role, editingMemory, actions }: ScreenProps) {
  const state = entry.state
  const kind = state.startsWith('note') ? 'note' : state.startsWith('video') ? 'video' : state.startsWith('edit') ? 'edit' : 'photo'
  const { status, setStatus, save } = useLocalSave(state.replace(/^(note|video|photo)-(?=saving|success|error|validation|cancel|reserve|upload|processing|publishing)/, ''))
  const [body, setBody] = useState(kind === 'note' ? '' : kind === 'edit' ? editingMemory?.body ?? 'Обычный вечер, который хочется запомнить.' : 'Наш маленький художник. Сегодня всё получилось!')
  const [date, setDate] = useState('2026-10-02')
  const [media, setMedia] = useState<MediaModel[]>((state === 'video-empty' || state === 'photo-empty' ? [] : state === 'mixed' ? [photos.family, photos.painting, photos.portrait] : state === 'multi-photo' ? [photos.portrait, photos.family] : kind === 'note' ? [] : [photos.painting]).map((src, i) => ({ src, kind: kind === 'video' || state === 'mixed' && i === 1 ? 'video' : 'photo', alt: 'Выбранное вложение ' + (i + 1), orientation: 'landscape', status: 'ready', provider: 'MAX', duration: '0:24' })))
  if (role === 'viewer') return <PageContent><EmptyState title="Альбом можно смотреть" body="Добавлять и изменять воспоминания могут участники с полным доступом." action="Вернуться к ленте" onPress={() => actions.go('feed:all')} /></PageContent>
  if (status === 'success') return <PageContent><EmptyState title={kind === 'edit' ? 'Изменения сохранены' : 'Момент теперь в альбоме'} body="Близкие смогут вернуться к нему в любое время." action="Смотреть в ленте" onPress={() => actions.go('feed:all')} /><Button tone="secondary" onPress={() => { setStatus('note'); setBody('') }}>Добавить ещё</Button></PageContent>
  const progress: Record<string, [string, number]> = { reserve: ['Подготавливаем вложения…', 8], upload: ['Загружаем вложения…', 42], processing: ['Обрабатываем вложения…', 100], publishing: ['Публикуем воспоминание…', 100], saving: ['Сохраняем ваш момент…', 64] }
  const errors: Record<string, string> = { error: 'Не удалось сохранить воспоминание.', 'reserve-error': 'Не удалось подготовить загрузку.', 'upload-error': 'Загрузка прервалась. Выбранные вложения сохранены в форме.', 'finalize-error': 'Не удалось завершить обработку вложений.', 'publish-uncertain': 'Ответ о публикации не получен. Повторите сохранение этой же заявки, чтобы проверить результат.', 'restart-required': 'Эта загрузка истекла. Выберите вложения заново.', 'edit-conflict': 'Воспоминание изменил другой участник. Обновите данные перед сохранением.' }
  return <><TopBar title={kind === 'note' ? 'Сохранить слова' : kind === 'edit' ? 'Редактировать воспоминание' : kind === 'video' ? 'Добавить видео' : 'Добавить фото и видео'} onBack={() => actions.open('cancel-composer')} /><PageContent>
    <Typography variant="meta">{kind === 'note' ? 'Смешная фраза, маленькое открытие или просто дорогой вам день.' : 'История остаётся в вашем приватном семейном альбоме.'}</Typography>
    <form className="v2-stack" onSubmit={e => { e.preventDefault(); if (body.length > 8000 || (kind === 'note' && !body.trim()) || (kind !== 'note' && kind !== 'edit' && !media.length)) { setStatus('validation'); return }; save(() => actions.onSaveMemory(body.trim(), kind, media, date)) }}>
      {kind !== 'note' && kind !== 'edit' && <><div className="v2-media-selection">{media.map((item, i) => <div className="v2-selected-photo" key={i}><img alt={'Выбранное вложение ' + (i + 1)} src={item.src} /><Typography as="span" variant="caption">{item.kind === 'video' ? 'Видео' : 'Фото'} {i + 1}</Typography><IconButton name="close" label={'Удалить вложение ' + (i + 1)} onPress={() => setMedia(media.filter((_, j) => j !== i))} /><Button tone="quiet" disabled={i === 0} onPress={() => { const next = [...media]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setMedia(next) }}>Раньше</Button></div>)}</div><Button tone="secondary" disabled={media.length >= 10} onPress={() => setMedia([...media, { src: media.length % 2 ? photos.family : photos.painting, kind: kind === 'video' ? 'video' : 'photo', alt: 'Выбранное demo-вложение', orientation: 'landscape', status: 'ready', provider: 'MAX', duration: '0:24' }])}>{kind === 'video' ? 'Выбрать видео' : 'Выбрать фото и видео'}</Button><Typography variant="caption">{media.length} из 10 вложений</Typography></>}
      <Field label={kind === 'note' ? 'Текст воспоминания' : 'Подпись'}><textarea rows={kind === 'note' ? 9 : 4} placeholder="Напишите, что хочется запомнить…" value={body} maxLength={8000} onChange={e => setBody(e.target.value)} /></Field><Typography className="v2-field-count" variant="caption">{body.length} / 8000</Typography>
      <TextField label="Дата воспоминания" type="date" required max="2026-10-02" value={date} onChange={e => setDate(e.target.value)} />
      {status === 'validation' && <InlineNotice error>Добавьте текст или выберите вложения и проверьте дату.</InlineNotice>}
      {errors[status] && <><InlineNotice error>{errors[status]}</InlineNotice><Button tone="secondary" onPress={() => status === 'restart-required' ? (setMedia([]), setStatus('photo')) : status === 'edit-conflict' ? setStatus('edit') : save(() => actions.onSaveMemory(body.trim(), kind, media, date))}>{status === 'restart-required' ? 'Выбрать заново' : status === 'edit-conflict' ? 'Обновить данные' : 'Попробовать снова'}</Button></>}
      {progress[status] && <section className="v2-stack" role="status"><Typography>{progress[status][0]}</Typography><progress aria-label="Сохранение воспоминания" max={100} value={progress[status][1]} /><Typography variant="caption">Выбранные материалы остаются в форме</Typography></section>}
      <Button type="submit" disabled={Boolean(progress[status]) || status === 'restart-required' || status === 'edit-conflict'}>{kind === 'edit' ? 'Сохранить изменения' : 'Опубликовать'}</Button>
      <Button tone="quiet" onPress={() => actions.open('cancel-composer')}>Отмена</Button>
    </form>
  </PageContent></>
}
