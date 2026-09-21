export type MemolyTheme =
  | 'mint'
  | 'rose'
  | 'sky'
  | 'lavender'
  | 'apricot'
  | 'sand'

export const MEMOLY_THEME_STORAGE_KEY = 'memoly-theme'

export function applyMemolyTheme(theme: MemolyTheme) {
  document.documentElement.dataset.memolyTheme = theme
  localStorage.setItem(MEMOLY_THEME_STORAGE_KEY, theme)
}

export function readMemolyTheme(): MemolyTheme {
  const value = localStorage.getItem(MEMOLY_THEME_STORAGE_KEY)
  if (
    value === 'mint' ||
    value === 'rose' ||
    value === 'sky' ||
    value === 'lavender' ||
    value === 'apricot' ||
    value === 'sand'
  ) return value
  return 'mint'
}
