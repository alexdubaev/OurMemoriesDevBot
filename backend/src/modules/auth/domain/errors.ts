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
  | 'telegram_link_invalid'
  | 'telegram_link_conflict'
  | 'max_init_data_invalid'
  | 'max_init_data_replayed'
  | 'browser_link_invalid'

export class AuthFailure extends Error {
  constructor(
    public readonly kind: AuthFailureKind,
    message: string,
  ) {
    super(message)
  }
}
