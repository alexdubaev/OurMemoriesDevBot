import type { RefObject } from 'react'
import { WebpIcon } from '../../components/WebpIcon'
import { Typography } from '../../components/typography'
import { requestVideoStageFullscreen, supportsVideoStageFullscreen } from './video-fullscreen'

export function VideoPlaybackControls({
  current,
  duration,
  onToggle,
  playing,
  stageRef,
  videoRef,
  onSeek,
  available = true,
}: {
  current: number
  duration: number
  onToggle: () => void
  playing: boolean
  stageRef: RefObject<HTMLElement | null>
  videoRef: RefObject<HTMLVideoElement | null>
  onSeek: (position: number) => void
  available?: boolean
}) {
  const fullscreenAvailable = supportsVideoStageFullscreen()
  return <div className="memoly-video-playback-controls" data-slot="video-playback-controls">
  <div className="memoly-video-control-row">
      <button aria-label={playing ? 'Поставить видео на паузу' : 'Воспроизвести видео'} className="memoly-video-control" disabled={!available} onClick={onToggle} title={playing ? 'Пауза' : 'Воспроизвести'} type="button"><WebpIcon decorative name={playing ? 'pause' : 'play'} size={20} state="white" /></button>
      <Typography className="flex-1 text-right text-white" variant="memoryMeta">{seconds(current)} / {seconds(duration)}</Typography>
      <button aria-label="На весь экран" className="memoly-video-control" disabled={!available || !fullscreenAvailable} onClick={() => void requestVideoStageFullscreen(stageRef.current, videoRef.current)} title="На весь экран" type="button"><WebpIcon decorative monochrome name="fullscreen" size={18} /></button>
    </div>
    <input aria-label="Позиция видео" disabled={!available} max={Number.isFinite(duration) ? duration : 0} min="0" onChange={(event) => onSeek(Number(event.currentTarget.value))} step="0.1" type="range" value={current} />
  </div>
}

function seconds(value: number) {
  return Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '0:00'
}
