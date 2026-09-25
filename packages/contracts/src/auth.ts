import { z } from 'zod'

const displayNameSchema = z
  .union([z.string().trim().min(2).max(80), z.literal('')])
  .optional()
  .transform((value) => {
    if (value === '' || value === undefined) return undefined
    return value
  })

export const emailSchema = z.string().trim().toLowerCase().email().max(254)

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

export const userRoleSchema = z.enum(['user', 'admin'])
export const memolyThemeSchema = z.enum(['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'])

export const userSchema = z.object({
  id: z.string(),
  email: emailSchema.nullable(),
  displayName: z.string().nullable(),
  role: userRoleSchema,
  theme: memolyThemeSchema.optional(),
  createdAt: z.string().datetime(),
})

export const telegramAuthRequestSchema = z
  .object({
    initData: z.string().min(1).max(16_384),
  })
  .strict()

export const maxAuthRequestSchema = z
  .object({
    initData: z.string().min(1).max(16_384),
  })
  .strict()

export const browserLinkStartResponseSchema = z.object({
  challengeId: z.string().min(1),
  displayCode: z.string().regex(/^\d{6}$/),
  expiresAt: z.string().datetime(),
  startParam: z.string().min(1),
}).strict()

export const browserLinkStatusResponseSchema = z.object({
  status: z.enum(['pending', 'approved', 'expired']),
  expiresAt: z.string().datetime(),
}).strict()

export const browserLinkApproveResponseSchema = z.object({
  approved: z.literal(true),
}).strict()

export const browserLinkApproveRequestSchema = z.object({
  initData: z.string().min(1).max(16_384),
  approved: z.literal(true),
}).strict()

export const browserLinkChallengeParamsSchema = z.object({
  id: z.string().regex(/^\d{24}$/),
}).strict()

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
})

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
})

export const passwordResetRequestResponseSchema = z.object({
  accepted: z.literal(true),
})

export const passwordResetConfirmRequestSchema = z.object({
  token: z.string().trim().min(43).max(256),
  password: passwordSchema,
})

export const cookieRefreshRequestSchema = z.object({}).strict().optional().default({})
export const cookieLogoutRequestSchema = z.object({}).strict().optional().default({})

export const tokenRefreshRequestSchema = z.object({
  refreshToken: z.string().min(32),
})

export const tokenLogoutRequestSchema = tokenRefreshRequestSchema

export const cookieAuthResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
}).strict()

export const tokenAuthResponseSchema = cookieAuthResponseSchema.extend({
  refreshToken: z.string(),
})

export const cookieRefreshResponseSchema = z.object({
  accessToken: z.string(),
}).strict()

export const tokenRefreshResponseSchema = cookieRefreshResponseSchema.extend({
  refreshToken: z.string(),
})

export const meResponseSchema = z.object({
  user: userSchema,
  externalIdentityProvider: z.enum(['max', 'telegram']).nullable().optional(),
})

export type UserDto = z.infer<typeof userSchema>
export type TelegramAuthRequest = z.infer<typeof telegramAuthRequestSchema>
export type MaxAuthRequest = z.infer<typeof maxAuthRequestSchema>
export type BrowserLinkStartResponse = z.infer<typeof browserLinkStartResponseSchema>
export type BrowserLinkStatusResponse = z.infer<typeof browserLinkStatusResponseSchema>
export type BrowserLinkApproveResponse = z.infer<typeof browserLinkApproveResponseSchema>
export type BrowserLinkApproveRequest = z.infer<typeof browserLinkApproveRequestSchema>
export type BrowserLinkChallengeParams = z.infer<typeof browserLinkChallengeParamsSchema>
export type UserRole = z.infer<typeof userRoleSchema>
export type MemolyTheme = z.infer<typeof memolyThemeSchema>
export type RegisterRequest = z.input<typeof registerRequestSchema>
export type RegisterPayload = z.output<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>
export type PasswordResetRequestResponse = z.infer<typeof passwordResetRequestResponseSchema>
export type PasswordResetConfirmRequest = z.infer<typeof passwordResetConfirmRequestSchema>
export type CookieRefreshRequest = z.infer<typeof cookieRefreshRequestSchema>
export type CookieLogoutRequest = z.infer<typeof cookieLogoutRequestSchema>
export type TokenRefreshRequest = z.infer<typeof tokenRefreshRequestSchema>
export type TokenLogoutRequest = z.infer<typeof tokenLogoutRequestSchema>
export type CookieAuthResponse = z.infer<typeof cookieAuthResponseSchema>
export type TokenAuthResponse = z.infer<typeof tokenAuthResponseSchema>
export type CookieRefreshResponse = z.infer<typeof cookieRefreshResponseSchema>
export type TokenRefreshResponse = z.infer<typeof tokenRefreshResponseSchema>
export type MeResponse = z.infer<typeof meResponseSchema>
