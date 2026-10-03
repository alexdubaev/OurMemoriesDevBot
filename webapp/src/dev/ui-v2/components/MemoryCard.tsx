import { useRef, useState } from 'react'
import type { MediaModel, MemoryCardModel } from '../fixtures/models'
import { Avatar, Badge, Button, Icon, IconButton, Pressable } from '../primitives/controls'
import { PersonName, Typography } from '../primitives/Typography'
import { allowedReactions } from '../fixtures/data'
import { InlineNotice } from './Feedback'

export function MediaSurface({ media, onOpen, interactive = true }: { media: MediaModel; onOpen: () => void; interactive?: boolean }) {
  const status = media.status ?? 'ready'
  const unavailable = ['unavailable', 'error', 'unknown', 'checking', 'check-error'].includes(status)
  return <div className={'v2-media v2-media--' + media.orientation}>
    {!unavailable && <img src={media.src} alt={media.alt} width={1200} height={media.orientation === 'portrait' ? 1600 : 900} />}
    {media.kind === 'photo' ? interactive && <Pressable className="v2-media-open" aria-label={'Открыть фото: ' + media.alt} onPress={onOpen} /> :
      status === 'ready' ? <Pressable className="v2-video-play" aria-label="Смотреть видео" onPress={onOpen}><span><Icon name="play" size={32} /></span></Pressable> :
      <div className="v2-media-status" role={status === 'unavailable' || status === 'error' || status === 'check-error' ? 'alert' : 'status'}>
        <Typography variant="section">{status === 'processing' ? 'Готовим видео' : status === 'unknown' ? 'Готовность пока неизвестна' : status === 'checking' ? 'Проверяем готовность…' : status === 'check-error' ? 'Не удалось проверить видео' : status === 'error' ? 'Не удалось открыть медиа' : 'Видео недоступно'}</Typography>
        <Typography variant="meta">{status === 'processing' ? 'Момент уже сохранён. Просмотр появится чуть позже.' : 'Воспоминание остаётся в семейном альбоме.'}</Typography>
        <Button tone="secondary" onPress={onOpen}>{status === 'unavailable' ? 'Открыть в MAX' : 'Проверить готовность'}</Button>
      </div>}
    {media.kind === 'video' && status === 'ready' && <Typography as="span" variant="caption" className="v2-video-meta">{media.provider} · {media.duration}</Typography>}
  </div>
}
export function Carousel({ media, onOpen }: { media: MediaModel[]; onOpen: (index: number) => void }) {
  const [index, setIndex] = useState(0)
  const pointer = useRef<number | null>(null)
  const safeIndex = Math.min(index, media.length - 1)
  function move(next: number) { setIndex(Math.max(0, Math.min(media.length - 1, next))) }
  if (!media.length) return null
  return <div className="v2-carousel" aria-label="Медиа воспоминания"
    onPointerDown={(e) => { pointer.current = e.clientX }}
    onPointerUp={(e) => { if (pointer.current !== null && Math.abs(e.clientX - pointer.current) > 44) move(safeIndex + (e.clientX < pointer.current ? 1 : -1)); pointer.current = null }}
    onPointerCancel={() => { pointer.current = null }}>
    <MediaSurface media={media[safeIndex]} onOpen={() => onOpen(safeIndex)} />
    {media.length > 1 && <div className="v2-carousel-controls"><IconButton name="back" label="Предыдущее медиа" disabled={safeIndex === 0} onPress={() => move(safeIndex - 1)} /><div className="v2-dots" aria-label={`Медиа ${safeIndex + 1} из ${media.length}`}>{media.map((_, i) => <span className={i === safeIndex ? 'selected' : ''} key={i} />)}</div><Typography as="span" variant="caption">{safeIndex + 1} / {media.length}</Typography><IconButton name="chevron" label="Следующее медиа" disabled={safeIndex === media.length - 1} onPress={() => move(safeIndex + 1)} /></div>}
  </div>
}
export function VoiceSurface({ model, initialPlaying = false, error = false }: { model: NonNullable<MemoryCardModel['voice']>; initialPlaying?: boolean; error?: boolean }) {
  const [playing, setPlaying] = useState(initialPlaying)
  const [position, setPosition] = useState(initialPlaying ? 12 : 0)
  const [failed, setFailed] = useState(error)
  return <div className="v2-voice">
    <div className="v2-row"><IconButton name={playing ? 'pause' : 'play'} label={playing ? 'Приостановить голос' : 'Слушать голос'} onPress={() => setPlaying(!playing)} disabled={failed} /><div className="v2-voice-body"><div className="v2-waveform" aria-hidden="true">{model.peaks.map((height, i) => <span className={i / model.peaks.length < position / model.duration ? 'played' : ''} key={i} style={{ height }} />)}</div><input className="v2-voice-seek" aria-label="Позиция голосового сообщения" type="range" min={0} max={model.duration} value={position} onChange={(e) => setPosition(Number(e.target.value))} /></div></div>
    <div className="v2-voice-time"><Typography as="span" variant="meta">{playing ? 'Бабушкин голос · слушаем' : 'Бабушкин голос'}</Typography><Typography as="span" variant="caption">0:{String(position).padStart(2, '0')} / 0:{model.duration}</Typography></div>
    {failed && <><InlineNotice error>Не удалось загрузить голос. Попробуйте открыть снова.</InlineNotice><Button tone="secondary" onPress={() => setFailed(false)}>Повторить</Button></>}
  </div>
}
export function ReactionPicker({ selected, onSelect }: { selected?: string; onSelect: (emoji: string) => void }) {
  return <div className="v2-reaction-picker" role="group" aria-label="Выберите реакцию">{allowedReactions.map((emoji) => <Pressable aria-label={'Реакция ' + emoji} aria-pressed={selected === emoji} key={emoji} onPress={() => onSelect(emoji)}><Typography as="span" variant="title">{emoji}</Typography></Pressable>)}</div>
}
export function MemoryCard({ model, onOpen, onActions, onReactions, onReact, voicePlaying, voiceError, reactionError }: {
  model: MemoryCardModel; onOpen: (index: number) => void; onActions: () => void
  onReactions: () => void; onReact: (emoji: string) => void; voicePlaying?: boolean; voiceError?: boolean; reactionError?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  return <article className="v2-memory" data-component="MemoryCard" data-memory={model.id}>
    <header className="v2-memory-header"><Avatar name={model.author.name} src={model.author.avatar} /><div className="v2-stack v2-memory-author"><PersonName>{model.author.name}</PersonName><Typography variant="caption">{model.date}{model.unread ? ' · Новое' : ''}</Typography></div><IconButton name="more" label="Действия с воспоминанием" onPress={onActions} /></header>
    {model.kind === 'media' && <Carousel media={model.media} onOpen={onOpen} />}
    {model.kind === 'note' && <div className={'v2-note' + (expanded ? ' expanded' : '')}><Typography>{model.body}</Typography>{model.body.length > 280 && <Button tone="quiet" onPress={() => setExpanded(!expanded)}>{expanded ? 'Свернуть' : 'Читать полностью'}</Button>}</div>}
    {model.kind === 'voice' && model.voice && <VoiceSurface model={model.voice} initialPlaying={voicePlaying} error={voiceError} />}
    {model.kind !== 'note' && <Typography className="v2-memory-caption">{model.body}</Typography>}
    <footer className="v2-memory-footer"><div className="v2-reaction-summary">
      {model.reactions.map(({ emoji, count }) => <Pressable aria-label={`Реакция ${emoji}, ${count}`} aria-pressed={model.ownReaction === emoji} key={emoji} onLongPress={onReactions} onPress={() => onReact(emoji)}><Typography as="span" variant="meta">{emoji} {count}</Typography></Pressable>)}
      {!model.reactions.length && <Typography as="span" variant="caption">Реакций пока нет</Typography>}
    </div><Pressable className="v2-reaction-add" aria-label="Выбрать реакцию" onLongPress={onReactions} onPress={onReactions}><Icon name="heart" /><Typography as="span" variant="caption">Откликнуться</Typography></Pressable></footer>
    {reactionError && <InlineNotice error>Реакция не сохранена. Попробуйте ещё раз.</InlineNotice>}
  </article>
}
export function MemoryTypeLabel({ children }: { children: string }) { return <Badge>{children}</Badge> }
