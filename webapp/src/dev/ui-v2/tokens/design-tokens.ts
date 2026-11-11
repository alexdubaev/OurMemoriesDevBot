export const themes = {
  mint: { label: 'memoLy', accent: '#486d5e', tint: '#e5ede5', wash: '#f2f5ee', detail: '#a1b6a3' },
} as const
export type Theme = keyof typeof themes
export const tokens = {
  colors: { milk: '#f7f2eb', paper: '#fffcf7', ink: '#504e49', secondary: '#706e67', line: '#ebe6de', danger: '#a33f3b', dangerTint: '#f9e9e6', viewer: '#202620', white: '#ffffff', portraitMat: '#f7e3cc', note: '#faf0d9' },
  semantic: { canvas: 'milk', surface: 'paper', text: 'ink', muted: 'secondary', border: 'line', destructive: 'danger' },
  themes,
  spacing: { micro: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48, '4xl': 64 },
  radii: { small: 8, field: 12, surface: 24, sheet: 24, pill: 999 },
  typography: { family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', caption: 12, meta: 13, body: 16, person: 15, section: 19, title: 26, display: 28, code: 28 },
  weights: { regular: 400, medium: 500, strong: 600 },
  lineHeights: { compact: 1.2, title: 1.3, body: 1.55 },
  shadows: { surface: '0 4px 20px #665a4510', overlay: '0 12px 48px #20262024' },
  icons: { small: 20, standard: 24, large: 32, feedback: 48 },
  targets: { minimum: 44, primary: 48 },
  motion: { press: 100, fast: 160, normal: 220, hold: 450, easing: 'cubic-bezier(.2,.8,.2,1)' },
  safeAreas: { top: 0, bottom: 0, hostTop: 0, hostBottom: 0 },
  layers: { content: 0, navigation: 10, backdrop: 20, overlay: 30, toast: 40 },
  layout: { page: 20, narrowPage: 16, contentMax: 560, navHeight: 82, heroAvatar: 84, avatar: 40, previewHeight: 844, sheetMax: 560, feedMediaMax: 300, feedInset: 12 },
} as const

export function tokenVariables(theme: Theme): Record<string, string | number> {
  const variables: Record<string, string | number> = {}
  const sizes = ['spacing', 'radii', 'typography', 'icons', 'targets', 'layout', 'safeAreas']
  for (const [group, values] of Object.entries(tokens)) {
    if (group === 'themes' || group === 'semantic') continue
    for (const [key, value] of Object.entries(values)) {
      variables['--v2-' + group + '-' + key] = typeof value === 'number' && sizes.includes(group) ? value + 'px' : value
    }
  }
  for (const [key, value] of Object.entries(themes[theme])) if (key !== 'label') variables['--v2-' + key] = value
  return variables
}
