export type AlbumFailureKind = 'not_found' | 'scope_unavailable' | 'forbidden' | 'conflict' | 'version_conflict' | 'idempotency_conflict' | 'invalid_input'

export class AlbumFailure extends Error {
  constructor(public readonly kind: AlbumFailureKind, message: string) {
    super(message)
    this.name = 'AlbumFailure'
  }
}

export function albumMissing() { return new AlbumFailure('not_found', 'Альбом или исходник не найден') }
export function albumScopeUnavailable() { return new AlbumFailure('scope_unavailable', 'Семейный доступ недоступен') }
export function albumVersionConflict() { return new AlbumFailure('version_conflict', 'Альбом изменён. Обновите данные и повторите действие') }
