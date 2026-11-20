// Элементы управления, с которых свайп карусели не начинается: поля, ссылки, ползунки, полоса плеера и обычные кнопки.
const SWIPE_CONTROL_SELECTOR = 'input, select, textarea, a, [role="slider"], [data-slot="video-playback-controls"], button'

// Кнопки, занимающие кадр медиа: открытие фото, запуск видео и постер неактивного видео.
// С них свайп начинается, а тап без движения по-прежнему открывает фото или запускает видео.
const SWIPE_MEDIA_SURFACE_SELECTOR = '[data-slot="max-video-play"], .memoly-private-video-v2-play, .memoly-mixed-slide-poster > button, button.ml-media-button'

export function isSwipeBlockingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-slot="video-playback-controls"]')) return true
  const control = target.closest(SWIPE_CONTROL_SELECTOR)
  return Boolean(control && !control.matches(SWIPE_MEDIA_SURFACE_SELECTOR))
}
