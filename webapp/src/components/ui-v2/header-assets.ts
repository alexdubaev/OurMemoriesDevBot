import type { MemolyTheme } from '@/features/theme'

const HEADER_ASSETS: Record<MemolyTheme, string> = {
  mint: '/assets/ui-v2/headers/header-bunny-meadow.webp',
  rose: '/assets/ui-v2/headers/header-kite-sunset.webp',
  sky: '/assets/ui-v2/headers/header-airplane-sky.webp',
  lavender: '/assets/ui-v2/headers/header-whale-ocean.webp',
  apricot: '/assets/ui-v2/headers/header-bear-forest.webp',
  sand: '/assets/ui-v2/headers/header-moon-dream.webp',
}

export function getUiV2HeaderAsset(theme: MemolyTheme): string {
  return HEADER_ASSETS[theme]
}
