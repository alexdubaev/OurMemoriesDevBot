/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'

import { MEMOLY_THEME_STORAGE_KEY, readMemolyTheme, type MemolyTheme } from './theme'

type MemolyThemeContextValue = {
  theme: MemolyTheme
  setTheme: (theme: MemolyTheme) => void
}

const MemolyThemeContext = createContext<MemolyThemeContextValue | null>(null)

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<MemolyTheme>(readMemolyTheme)
  const setTheme = useCallback((nextTheme: MemolyTheme) => setThemeState(nextTheme), [])

  useEffect(() => {
    document.documentElement.dataset.memolyTheme = theme
    window.localStorage.setItem(MEMOLY_THEME_STORAGE_KEY, theme)
  }, [theme])

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme])

  return (
    <div className="memoly-app-root" data-memoly-theme={theme} data-slot="memoly-theme-root">
      <MemolyThemeContext.Provider value={value}>{children}</MemolyThemeContext.Provider>
    </div>
  )
}

export function useMemolyTheme(): MemolyThemeContextValue {
  const context = useContext(MemolyThemeContext)
  // Presentation components are also rendered in focused tests and Storybook
  // fixtures without the application shell. Keep those consumers deterministic
  // while the production app still owns state through ThemeProvider.
  return context ?? { theme: 'mint', setTheme: () => undefined }
}
