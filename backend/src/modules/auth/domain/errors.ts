export type AuthFailureKind =
  | 'access_token_invalid'
  | 'access_token_required'
  | 'email_already_exists'
  | 'invalid_credentials'
  | 'password_reset_invalid'
  | 'refresh_session_invalid'
  | 'refresh_token_required'
  | 'session_invalid'
  | 'telegram_init_data_invalid'
  | 'telegram_init_data_replayed'

export class AuthFailure extends Error {
  constructor(
    public readonly kind: AuthFailureKind,
    message: string,
  ) {
    super(message)
  }
}
