/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'

import { AuthContext } from '@/features/auth'
import { isMemolyTheme, type MemolyTheme } from './theme'

type MemolyThemeContextValue = {
  theme: MemolyTheme
  setTheme: (theme: MemolyTheme) => void
}

const MemolyThemeContext = createContext<MemolyThemeContextValue | null>(null)

export function ThemeProvider({ children }: PropsWithChildren) {
  const auth = useContext(AuthContext)
  const serverTheme = isMemolyTheme(auth?.user?.theme) ? auth.user.theme : 'mint'
  const [theme, setThemeState] = useState<MemolyTheme>(serverTheme)
  const updateQueue = useRef<Promise<void>>(Promise.resolve())
  const latestUpdate = useRef(0)
  const updatePending = useRef(false)
  const setTheme = useCallback((nextTheme: MemolyTheme) => {
    setThemeState(nextTheme)
    if (!auth?.user) return
    const updateId = ++latestUpdate.current
    updatePending.current = true
    const update = updateQueue.current.catch(() => undefined).then(() => auth.updateTheme(nextTheme))
    updateQueue.current = update
    void update.then(() => {
      if (updateId === latestUpdate.current) updatePending.current = false
    }).catch(() => {
      if (updateId === latestUpdate.current) {
        updatePending.current = false
        setThemeState(auth.user?.theme ?? 'mint')
      }
    })
  }, [auth])

  useEffect(() => {
    if (!updatePending.current) setThemeState(serverTheme)
  }, [serverTheme])

  useEffect(() => {
    document.documentElement.dataset.memolyTheme = theme
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
