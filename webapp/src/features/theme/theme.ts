export const MEMOLY_THEME_STORAGE_KEY = 'memoly-theme'

export const MEMOLY_THEMES = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const

export type MemolyTheme = (typeof MEMOLY_THEMES)[number]

export type MemolyThemeConfig = {
  label: string
  headerArtUrl: string
}

export const MEMOLY_THEME_CONFIG: Record<MemolyTheme, MemolyThemeConfig> = {
  mint: { label: 'Мята', headerArtUrl: '/assets/theme-header/mint.webp' },
  rose: { label: 'Роза', headerArtUrl: '/assets/theme-header/rose.webp' },
  sky: { label: 'Небо', headerArtUrl: '/assets/theme-header/sky.webp' },
  lavender: { label: 'Лаванда', headerArtUrl: '/assets/theme-header/lavender.webp' },
  apricot: { label: 'Абрикос', headerArtUrl: '/assets/theme-header/apricot.webp' },
  sand: { label: 'Песок', headerArtUrl: '/assets/theme-header/sand.webp' },
}

export function isMemolyTheme(value: string | null | undefined): value is MemolyTheme {
  return value != null && (MEMOLY_THEMES as readonly string[]).includes(value)
}

export function readMemolyTheme(): MemolyTheme {
  if (typeof window === 'undefined') return 'mint'
  const value = window.localStorage.getItem(MEMOLY_THEME_STORAGE_KEY)
  return isMemolyTheme(value) ? value : 'mint'
}

export function getMemolyThemeConfig(theme: MemolyTheme): MemolyThemeConfig {
  return MEMOLY_THEME_CONFIG[theme]
}
