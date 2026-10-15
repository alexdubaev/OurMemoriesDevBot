import { createContext } from 'react'

export type PlaybackCoordinator = {
  activate(token: symbol, stop: () => void): void
  release(token: symbol): void
  clear(token: symbol): void
  pauseAll(): void
}

export const PlaybackContext = createContext<PlaybackCoordinator | null>(null)
