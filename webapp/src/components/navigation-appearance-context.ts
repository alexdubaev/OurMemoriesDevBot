import { createContext, useContext } from 'react'

export type NavigationTab = 'feed' | 'albums' | 'family' | 'gifts'
export type NavigationStyle = 'classic' | 'glass'
export type TabMotion = { from: NavigationTab; to: NavigationTab }

type NavigationAppearance = {
  style: NavigationStyle
  selectStyle: (style: NavigationStyle) => void
  motion: TabMotion | null
  moveIndicator: (from: NavigationTab, to: NavigationTab) => void
  finishMotion: (finished: TabMotion) => void
}

export const NavigationAppearanceContext = createContext<NavigationAppearance | null>(null)

export function useNavigationAppearance() {
  return useContext(NavigationAppearanceContext)
}
