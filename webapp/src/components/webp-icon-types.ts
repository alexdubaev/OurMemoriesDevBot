export const webpIconNames = [
  'chevron',
  'close',
  'family',
  'home',
  'info',
  'lock',
  'more',
  'note',
  'photo',
  'play',
  'plus',
  'retry',
  'voice',
  'warning',
] as const

export type WebpIconName = (typeof webpIconNames)[number]
export type WebpIconState = 'active' | 'default' | 'white'
