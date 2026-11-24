import { useState, type PropsWithChildren } from 'react'
import { NavigationAppearanceContext, type NavigationStyle, type NavigationTab, type TabMotion } from './navigation-appearance-context'

const preferenceKey = 'memoly:navigation-style'

function readStyle(): NavigationStyle {
  try {
    return window.localStorage.getItem(preferenceKey) === 'classic' ? 'classic' : 'glass'
  } catch {
    return 'glass'
  }
}

export function NavigationAppearanceProvider({ children }: PropsWithChildren) {
  const [style, setStyle] = useState(readStyle)
  const [motion, setMotion] = useState<TabMotion | null>(null)

  function selectStyle(next: NavigationStyle) {
    setStyle(next)
    setMotion(null)
    try {
      window.localStorage.setItem(preferenceKey, next)
    } catch {
      // The choice still applies for this session if the host blocks browser storage.
    }
  }

  function moveIndicator(from: NavigationTab, to: NavigationTab) {
    if (style !== 'glass' || from === to || !window.matchMedia('(width < 768px) and (prefers-reduced-motion: no-preference)').matches) return
    setMotion({ from, to })
  }

  function finishMotion(finished: TabMotion) {
    setMotion(current => current === finished ? null : current)
  }

  return <NavigationAppearanceContext.Provider value={{ style, selectStyle, motion, moveIndicator, finishMotion }}>
    {children}
  </NavigationAppearanceContext.Provider>
}
