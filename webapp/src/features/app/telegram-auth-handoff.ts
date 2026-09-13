export type TelegramAuthHandoffState = {
  hasInitData: boolean
  hasStartedTelegramAuth: boolean
  isAuthenticated: boolean
  isAuthBootstrapping: boolean
  isTelegramAuthPending: boolean
  isTelegramAvailable: boolean
}

export function shouldStartTelegramAuth(state: Omit<TelegramAuthHandoffState, 'isTelegramAuthPending'>) {
  return state.isTelegramAvailable
    && state.hasInitData
    && !state.isAuthBootstrapping
    && !state.isAuthenticated
    && !state.hasStartedTelegramAuth
}

export function shouldKeepTelegramAuthPreloader(state: TelegramAuthHandoffState) {
  return state.isTelegramAuthPending || shouldStartTelegramAuth(state)
}
