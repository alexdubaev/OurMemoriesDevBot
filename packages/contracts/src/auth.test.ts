import { describe, expect, test } from 'bun:test'

import type { UserDto } from './index'
import {
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  loginRequestSchema,
  meResponseSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  tokenAuthResponseSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
  tokenRefreshResponseSchema,
  maxAuthRequestSchema,
  telegramAuthRequestSchema,
  userSchema,
} from './index'

const validUser = {
  id: 'user_1',
  email: null,
  displayName: null,
  role: 'user',
  createdAt: '2026-05-11T00:00:00.000Z',
} satisfies UserDto

describe('auth contracts', () => {
  test('accepts only raw MAX initData for the public authentication exchange', () => {
    expect(maxAuthRequestSchema.parse({ initData: 'auth_date=1&user=%7B%7D&hash=abc' })).toEqual({
      initData: 'auth_date=1&user=%7B%7D&hash=abc',
    })
    expect(() => maxAuthRequestSchema.parse({ initData: '' })).toThrow()
    expect(() => maxAuthRequestSchema.parse({ initData: 'valid', userId: '123' })).toThrow()
    expect(() => maxAuthRequestSchema.parse({ initData: 'x'.repeat(16_385) })).toThrow()
  })

  test('accepts only raw Telegram initData for the public authentication exchange', () => {
    expect(telegramAuthRequestSchema.parse({ initData: 'query_id=q&auth_date=1&hash=h' })).toEqual({
      initData: 'query_id=q&auth_date=1&hash=h',
    })
    expect(() => telegramAuthRequestSchema.parse({ initData: '' })).toThrow()
    expect(() => telegramAuthRequestSchema.parse({ initData: 'valid', userId: '123' })).toThrow()
  })

  test('represents Telegram users without inventing an email address', () => {
    expect(userSchema.parse(validUser)).toEqual(validUser)
  })
  test('normalizes registration and login input', () => {
    expect(
      registerRequestSchema.parse({
        email: ' USER@Example.COM ',
        password: 'password123',
        displayName: ' Jane ',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
      displayName: 'Jane',
    })

    expect(
      registerRequestSchema.parse({
        email: 'user@example.com',
        password: 'password123',
        displayName: '',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
      displayName: undefined,
    })

    expect(
      loginRequestSchema.parse({
        email: ' USER@Example.COM ',
        password: 'password123',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'password123',
    })
  })

  test('rejects invalid auth request payloads', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'not-an-email',
        password: 'short',
        displayName: 'A',
      }),
    ).toThrow()

    expect(() =>
      loginRequestSchema.parse({
        email: 'user@example.com',
        password: 'short',
      }),
    ).toThrow()
  })

  test('normalizes password reset requests and keeps their response generic', () => {
    expect(passwordResetRequestSchema.parse({ email: ' USER@Example.COM ' })).toEqual({
      email: 'user@example.com',
    })
    expect(passwordResetRequestResponseSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    })
    expect(() => passwordResetRequestResponseSchema.parse({ accepted: false })).toThrow()
  })

  test('requires a bounded reset token and a valid replacement password', () => {
    const token = 't'.repeat(43)
    expect(
      passwordResetConfirmRequestSchema.parse({ token, password: 'new-password-123' }),
    ).toEqual({ token, password: 'new-password-123' })
    expect(() =>
      passwordResetConfirmRequestSchema.parse({ token: 'short', password: 'new-password-123' }),
    ).toThrow()
    expect(() =>
      passwordResetConfirmRequestSchema.parse({ token, password: 'short' }),
    ).toThrow()
  })

  test('keeps cookie requests empty and requires explicit token transport credentials', () => {
    expect(cookieRefreshRequestSchema.parse(undefined)).toEqual({})
    expect(cookieRefreshRequestSchema.parse({})).toEqual({})
    expect(cookieLogoutRequestSchema.parse(undefined)).toEqual({})
    expect(cookieLogoutRequestSchema.parse({})).toEqual({})

    const refreshToken = 'r'.repeat(32)
    expect(tokenRefreshRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })
    expect(tokenLogoutRequestSchema.parse({ refreshToken })).toEqual({ refreshToken })

    expect(() => cookieRefreshRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => cookieLogoutRequestSchema.parse({ refreshToken })).toThrow()
    expect(() => tokenRefreshRequestSchema.parse({})).toThrow()
    expect(() => tokenLogoutRequestSchema.parse({ refreshToken: 'short' })).toThrow()
  })

  test('keeps cookie responses token-free and requires tokens for explicit token transport', () => {
    expect(
      cookieAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
      }),
    ).toEqual({
      user: validUser,
      accessToken: 'access-token',
    })

    expect(() =>
      cookieAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
        refreshToken: 'must-not-be-exposed',
      }),
    ).toThrow()

    expect(
      tokenAuthResponseSchema.parse({
        user: validUser,
        accessToken: 'access-token',
        refreshToken: 'token-transport-refresh-token',
      }),
    ).toEqual({
      user: validUser,
      accessToken: 'access-token',
      refreshToken: 'token-transport-refresh-token',
    })

    expect(() => tokenAuthResponseSchema.parse({ user: validUser, accessToken: 'access-token' })).toThrow()
    expect(cookieRefreshResponseSchema.parse({ accessToken: 'access-token' })).toEqual({
      accessToken: 'access-token',
    })
    expect(
      tokenRefreshResponseSchema.parse({
        accessToken: 'access-token',
        refreshToken: 'token-transport-refresh-token',
      }),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'token-transport-refresh-token',
    })
    expect(meResponseSchema.parse({ user: validUser })).toEqual({ user: validUser })
  })

  test('validates stable API error response shape', () => {
    expect(
      apiErrorSchema.parse({
        error: {
          code: 'INVALID_INPUT',
          message: 'Проверьте правильность заполнения полей',
          requestId: '01993b24-7e7d-7000-8000-000000000001',
          fieldErrors: { email: 'Некорректное значение' },
        },
      }),
    ).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'Проверьте правильность заполнения полей',
        requestId: '01993b24-7e7d-7000-8000-000000000001',
        fieldErrors: { email: 'Некорректное значение' },
      },
    })

    expect(() => apiErrorSchema.parse({
      error: {
        code: 'INVALID_INPUT',
        message: 'Проверьте правильность заполнения полей',
        requestId: '01993b24-7e7d-7000-8000-000000000001',
        details: [{ path: ['email'], message: 'internal schema detail' }],
      },
    })).toThrow()

    expect(() =>
      apiErrorSchema.parse({
        error: {
          code: 'SOMETHING_ELSE',
          message: 'Nope',
        },
      }),
    ).toThrow()
  })
})
