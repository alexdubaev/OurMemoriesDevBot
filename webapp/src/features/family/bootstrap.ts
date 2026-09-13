import { ApiRequestError } from '@/platform/api'

export function createFamilyErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.code === 'ROLE_FORBIDDEN') return 'Создание семьи доступно участникам пилота. Обратитесь к организатору пилота.'
  return 'Не удалось создать семью. Проверьте соединение и повторите попытку.'
}
