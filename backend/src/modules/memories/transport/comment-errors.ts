import { AppError } from '../../../http/errors'
import { toMemoryAppError } from './errors'

export async function executeComment<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const mapped = toMemoryAppError(error)
    if (mapped instanceof AppError && mapped.status === 422)
      throw new AppError(400, mapped.code, mapped.message)
    throw mapped
  }
}
