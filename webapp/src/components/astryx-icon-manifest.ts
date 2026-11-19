import type { WebpIconName } from './webp-icon-types'

export const astryxIconAtlas = {
  url: '/assets/astryx/controls-v1.webp',
  width: 768,
  height: 768,
  alpha: true,
  bytes: 97460,
  sha256: '54920928660341676f055f73dd6e19049d65d5b7f4c30ba328d154d78938296e',
} as const

// Centers and viewport are measured in the original 1254px ImageGen board.
// The WebP atlas preserves those proportions after resampling.
const masterSize = 1254
const sampleSize = 176
const centers: Record<WebpIconName, readonly [number, number]> = {
  calendar: [140, 145],
  channel: [338, 149.5],
  chevron: [535, 148],
  clock: [723.5, 151.5],
  close: [922.5, 149],
  comments: [1116.5, 150],
  family: [138.5, 362],
  fullscreen: [339, 356],
  gift: [533.5, 354.5],
  edit: [728.5, 360],
  gear: [922.5, 358],
  home: [1120, 360],
  info: [137, 564],
  lock: [336, 562],
  more: [530.5, 563.5],
  palette: [724.5, 563],
  'help-circle': [920, 565.5],
  'archive-box': [1121, 564.5],
  'circle-info': [135, 772],
  pencil: [337, 772.5],
  note: [529, 771.5],
  photo: [725, 771],
  pause: [922, 770.5],
  play: [1121.5, 771.5],
  plus: [134.5, 961.5],
  retry: [329, 962.5],
  heart: [527, 963],
  'heart-filled': [721, 965.5],
  voice: [921.5, 961],
  star: [1120.5, 959.5],
  'settings-sliders': [136, 1146],
  trash: [332.5, 1149],
  'trash-can': [529, 1143],
  video: [726.5, 1149.5],
  warning: [925, 1144],
  user: [1120.5, 1147],
}

const maskImage = `url("${astryxIconAtlas.url}")`
const maskSize = `${masterSize / sampleSize * 100}%`

function offset(center: number) {
  return `${(center - sampleSize / 2) / (masterSize - sampleSize) * 100}%`
}

export function resolveAstryxIconMask(name: WebpIconName) {
  const [x, y] = centers[name]
  return { maskImage, maskSize, maskPosition: `${offset(x)} ${offset(y)}` }
}
