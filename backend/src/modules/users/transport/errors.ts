import { AppError } from '../../../http/errors'
import { UsersFailure } from '../domain/errors'

export function toUsersAppError(error: unknown) {
  if (!(error instanceof UsersFailure)) return error

  if (error.kind === 'forbidden') {
    return new AppError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия', error.message)
  }
  if (error.kind === 'not_found') {
    return new AppError(404, 'NOT_FOUND', 'Пользователь не найден', error.message)
  }
  return new AppError(409, 'CONFLICT', 'Не удалось изменить роль пользователя', error.message)
}

export async function executeUsers<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toUsersAppError(error)
  }
}
