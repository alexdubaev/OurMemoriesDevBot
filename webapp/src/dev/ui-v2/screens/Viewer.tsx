import { useState } from 'react'
import type { MemoryCardModel } from '../fixtures/models'
import { Button, IconButton } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import { MediaSurface } from '../components/MemoryCard'
import { InlineNotice } from '../components/Feedback'
export function Viewer({ model, state = 'photo', initialIndex = 0, onClose }: { model: MemoryCardModel; state?: string; initialIndex?: number; onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex)
  const [playing, setPlaying] = useState(state === 'video-playing')
  const [fullscreen, setFullscreen] = useState(state === 'fullscreen')
  const media = model.media[Math.min(index, model.media.length - 1)]
  const statusMap: Record<string, 'processing' | 'unknown' | 'checking' | 'check-error' | 'unavailable' | 'error'> = { processing: 'processing', unknown: 'unknown', checking: 'checking', 'check-error': 'check-error', unavailable: 'unavailable', error: 'error' }
  return <div className={'v2-viewer' + (fullscreen ? ' v2-viewer--fullscreen' : '')} aria-label="Просмотр воспоминания">
    <header className="v2-viewer-header"><Typography as="span" variant="meta">{model.author.name} · {model.date}</Typography><IconButton name="fullscreen" label={fullscreen ? 'Вернуть подпись' : 'Развернуть фото'} aria-pressed={fullscreen} onPress={() => setFullscreen(!fullscreen)} /><IconButton name="close" label="Закрыть просмотр" onPress={onClose} /></header>
    <div className="v2-viewer-stage">{state === 'note' || !media ? <Typography className="v2-viewer-note">{model.body}</Typography> : <MediaSurface media={{ ...media, kind: state.startsWith('video') || statusMap[state] || state === 'telegram-handoff' ? 'video' : media.kind, status: statusMap[state] ?? media.status }} interactive={false} onOpen={() => setPlaying(!playing)} />}</div>
    {media?.kind === 'video' || state.startsWith('video') ? <div className="v2-viewer-playback"><Button tone="secondary" onPress={() => setPlaying(!playing)}>{playing ? 'Приостановить' : 'Воспроизвести'}</Button><Typography variant="meta">{state === 'video-loading' ? 'Загружаем видео…' : playing ? '0:12 / 0:24' : '0:00 / 0:24'}</Typography><input type="range" aria-label="Позиция видео" min={0} max={24} defaultValue={playing ? 12 : 0} /><IconButton name="fullscreen" label="Во весь экран" onPress={() => setPlaying(false)} /></div> : null}
    {state === 'telegram-handoff' && <InlineNotice>Видео откроется в Telegram. После просмотра вернитесь в альбом.</InlineNotice>}
    {!fullscreen && <Typography className="v2-viewer-caption" variant="meta">{model.body}</Typography>}
    {model.media.length > 1 && <nav aria-label="Навигация в просмотре" className="v2-viewer-nav"><Button tone="quiet" disabled={index === 0} onPress={() => { setIndex(index - 1); setPlaying(false) }}>Назад</Button><Typography as="span" variant="meta">{index + 1} / {model.media.length}</Typography><Button tone="quiet" disabled={index === model.media.length - 1} onPress={() => { setIndex(index + 1); setPlaying(false) }}>Далее</Button></nav>}
  </div>
}
