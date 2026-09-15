/** MAX accepts initData for five minutes after auth_date and tolerates thirty future seconds. */
export const maxAuthDataMaxAgeSeconds = 300
export const maxAuthDataFutureToleranceSeconds = 30

/** Keep an inclusive auth_date boundary replay-blocked through the end of its accepted second. */
export const maxAuthReplayBoundaryPaddingSeconds = 1
