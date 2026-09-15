import type { DbClient } from '../../db'
import type { EmailDelivery } from '../../email'
import type { AppEnv } from '../../env'
import { drainPassCapacity } from '../../outbox'
import type { BackendRuntime } from '../../runtime'
import { AuthService } from './application/auth-service'
import { TelegramAuthService } from './application/telegram-auth-service'
import { MaxAuthService } from './application/max-auth-service'
import { passwordResetCooldownSeconds, type Clock, type LogoutCleanup, type ProjectUser } from './application/ports'
import { toBaseUserDto } from './domain/user'
import {
  createPrismaAuthRepository,
  createPrismaTelegramAuthRepository,
  createPrismaMaxAuthRepository,
} from './infrastructure/auth-repository'
import { signAccessToken, verifyAccessToken } from './infrastructure/access-tokens'
import { hashPassword, verifyPassword } from './infrastructure/passwords'
import { createPasswordResetNotifier } from './infrastructure/password-reset-notifier'
import { createPasswordResetTaskQueue } from './infrastructure/password-reset-task-queue'
import {
  createPasswordResetToken,
  hashPasswordResetToken,
} from './infrastructure/password-reset-tokens'
import {
  createRefreshToken,
  deriveRotatedRefreshToken,
  hashRefreshToken,
  hashRefreshTokenFamily,
} from './infrastructure/refresh-tokens'
import { verifyTelegramInitData } from './infrastructure/telegram-init-data'
import { verifyMaxInitData } from './infrastructure/max-init-data'
import { verifyTelegramBotIdentity } from './infrastructure/telegram-bot-identity'
import { createRequireAuth, createRequireRole, type AuthHttpEnv } from './transport/middleware'
import { executeAuth } from './transport/errors'
import { createLegacyAuthTestRoutes } from './transport/legacy-test-routes'
import { createAuthRoutes } from './transport/routes'

type CreateAuthModuleOptions = {
  clock?: Clock
  db: DbClient
  emailDelivery: EmailDelivery
  env: AppEnv
  logoutCleanup?: LogoutCleanup
  projectUser?: ProjectUser
  legacyPasswordAuthForTests?: boolean
}

const systemClock: Clock = {
  now: () => new Date(),
}

const noLogoutCleanup: LogoutCleanup = () => undefined

export function createAuthModule({
  clock = systemClock,
  db,
  emailDelivery,
  env,
  logoutCleanup = noLogoutCleanup,
  projectUser = toBaseUserDto,
  legacyPasswordAuthForTests = false,
}: CreateAuthModuleOptions) {
  const service = buildAuthService({ clock, db, emailDelivery, env, logoutCleanup, projectUser })
  const telegramService = buildTelegramAuthService({ clock, db, env, projectUser })
  const maxService = buildMaxAuthService({ clock, db, env, projectUser })
  const requireAuth = createRequireAuth((accessToken) => service.authenticateAccessToken(accessToken))

  return {
    authenticateAccessToken: (accessToken: string | undefined) =>
      service.authenticateAccessToken(accessToken),
    authenticateMediaAccess: (accessToken: string | undefined) =>
      executeAuth(() => service.authenticateAccessToken(accessToken)),
    requireAuth,
    requireAdmin: createRequireRole('admin'),
    legacyTestRoutes: legacyPasswordAuthForTests
      ? createLegacyAuthTestRoutes({ env, requireAuth, service })
      : undefined,
    routes: createAuthRoutes({ env, service, telegramService, maxService }),
  }
}

function buildMaxAuthService({
  clock,
  db,
  env,
  projectUser,
}: Pick<Required<CreateAuthModuleOptions>, 'clock' | 'db' | 'env' | 'projectUser'>) {
  const sessions = createPrismaAuthRepository(db)
  return new MaxAuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    clock,
    projectUser,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    refreshTokens: {
      create: () => createRefreshToken(env.JWT_SECRET),
      hash: hashRefreshToken,
      familyHash: (token) => hashRefreshTokenFamily(token, env.JWT_SECRET),
      rotate: (token) => deriveRotatedRefreshToken(token, env.JWT_SECRET),
    },
    repository: createPrismaMaxAuthRepository(db, sessions),
    verifyInitData: (rawInitData) => {
      if (!env.MAX_BOT_TOKEN) throw new Error('MAX authentication is not configured')
      return verifyMaxInitData(rawInitData, {
        botToken: env.MAX_BOT_TOKEN,
        now: clock.now(),
      })
    },
  })
}

type BuildAuthServiceOptions = Required<Omit<CreateAuthModuleOptions, 'legacyPasswordAuthForTests'>>

function buildTelegramAuthService({
  clock,
  db,
  env,
  projectUser,
}: Pick<Required<CreateAuthModuleOptions>, 'clock' | 'db' | 'env' | 'projectUser'>) {
  const sessions = createPrismaAuthRepository(db)
  return new TelegramAuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    clock,
    projectUser,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    refreshTokens: {
      create: () => createRefreshToken(env.JWT_SECRET),
      hash: hashRefreshToken,
      familyHash: (token) => hashRefreshTokenFamily(token, env.JWT_SECRET),
      rotate: (token) => deriveRotatedRefreshToken(token, env.JWT_SECRET),
    },
    repository: createPrismaTelegramAuthRepository(db, sessions),
    verifyInitData: (rawInitData) => {
      if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram authentication is not configured')
      return verifyTelegramInitData(rawInitData, {
        botToken: env.TELEGRAM_BOT_TOKEN,
        now: clock.now(),
      })
    },
  })
}

/**
 * The same service without the HTTP surface, for the outbox handlers.
 *
 * A drain runs under `cron.ts`: building routes and middleware there to send one email would be
 * paying for a web server nobody is talking to.
 */
export function createAuthTasks(runtime: BackendRuntime) {
  const service = buildAuthService({
    clock: systemClock,
    db: runtime.prisma,
    emailDelivery: runtime.emailDelivery,
    env: runtime.env,
    logoutCleanup: noLogoutCleanup,
    projectUser: toBaseUserDto,
  })

  return {
    deliverPasswordChanged: service.deliverPasswordChanged.bind(service),
    deliverPasswordReset: service.deliverPasswordReset.bind(service),
  }
}

function buildAuthService({
  clock,
  db,
  emailDelivery,
  env,
  logoutCleanup,
  projectUser,
}: BuildAuthServiceOptions) {
  return new AuthService({
    accessTokens: {
      sign: (payload) => signAccessToken(payload, env),
      verify: (token) => verifyAccessToken(token, env),
    },
    clock,
    logoutCleanup,
    passwordResetCooldownSeconds,
    passwordResetNotifier: createPasswordResetNotifier(
      emailDelivery,
      env.WEBAPP_ORIGIN ?? env.CORS_ORIGINS[0] ?? 'http://localhost:5173',
    ),
    passwordResetTokenTtlMinutes: 30,
    passwordResetTokens: {
      create: createPasswordResetToken,
      hash: hashPasswordResetToken,
    },
    passwords: {
      hash: hashPassword,
      verify: verifyPassword,
    },
    projectUser,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    sessionAbsoluteTtlDays: env.SESSION_ABSOLUTE_TTL_DAYS,
    refreshTokens: {
      create: () => createRefreshToken(env.JWT_SECRET),
      hash: hashRefreshToken,
      familyHash: (token) => hashRefreshTokenFamily(token, env.JWT_SECRET),
      rotate: (token) => deriveRotatedRefreshToken(token, env.JWT_SECRET),
    },
    passwordResetTasks: createPasswordResetTaskQueue(db, { pendingLimit: drainPassCapacity(env) }),
    repository: createPrismaAuthRepository(db),
  })
}

export type { AuthHttpEnv }
export type { LogoutCleanup, ProjectUser } from './application/ports'
export type { AuthenticatedPrincipal } from './domain/user'
export { signAccessToken, verifyTelegramBotIdentity }
