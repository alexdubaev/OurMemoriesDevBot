import { Api } from 'grammy'

import type { TelegramApiPort, TelegramDownload } from '../application/ports'

export class TelegramProviderError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message)
    this.name = 'TelegramProviderError'
  }
}

export function createTelegramApi(token: string, fileMaxBytes: number): TelegramApiPort {
  const api = new Api(token)
  const fileBase = `https://api.telegram.org/file/bot${token}/`

  return {
    async download(fileId, expectedSize, signal) {
      if (expectedSize !== null && expectedSize > fileMaxBytes) throw new TelegramProviderError('Telegram file is too large')
      try {
        const file = await api.getFile(fileId, signal)
        const declaredSize = file.file_size ?? expectedSize
        if (!file.file_path || (declaredSize !== null && declaredSize > fileMaxBytes)) {
          throw new TelegramProviderError('Telegram file is unavailable or too large')
        }
        const response = await fetch(new URL(file.file_path, fileBase), { signal })
        if (!response.ok || !response.body) throw new TelegramProviderError('Telegram file download failed')
        const headerLength = Number(response.headers.get('content-length'))
        if (Number.isFinite(headerLength) && headerLength > fileMaxBytes) {
          await response.body.cancel()
          throw new TelegramProviderError('Telegram file is too large')
        }
        const byteSize = Number.isSafeInteger(headerLength) && headerLength > 0 ? headerLength : declaredSize
        if (byteSize === null) {
          await response.body.cancel()
          throw new TelegramProviderError('Telegram file size is unavailable')
        }
        return {
          body: limitStream(response.body, fileMaxBytes),
          byteSize,
          contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        } satisfies TelegramDownload
      } catch (error) {
        if (error instanceof TelegramProviderError) throw error
        throw telegramProviderFailure(error)
      }
    },
    async sendMessage(chatId, text, options) {
      try {
        await api.sendMessage(chatId, text, {
          ...(options?.replyToMessageId ? { reply_parameters: { message_id: Number(options.replyToMessageId) } } : {}),
          ...(options?.buttons?.length ? { reply_markup: telegramInlineKeyboard(options.buttons) } : {}),
        })
      } catch (error) {
        throw telegramProviderFailure(error)
      }
    },
    async getUpdates(offset, signal) {
      try {
        return await api.getUpdates({ offset, timeout: 25, allowed_updates: ['message'] }, signal)
      } catch (error) {
        throw telegramProviderFailure(error)
      }
    },
    async setCommands(commands) {
      try { await api.setMyCommands(commands) } catch (error) { throw telegramProviderFailure(error) }
    },
    async setMenuButton(url) {
      try { await api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Открыть ленту', web_app: { url } } }) }
      catch (error) { throw telegramProviderFailure(error) }
    },
  }
}

export function telegramInlineKeyboard(buttons: Array<{ text: string; webAppUrl: string }>) {
  return {
    inline_keyboard: [buttons.map((button) => ({ text: button.text, web_app: { url: button.webAppUrl } }))],
  }
}

export function telegramProviderFailure(error: unknown) {
  const retryAfter = readRetryAfter(error)
  return new TelegramProviderError('Telegram Bot API request failed', retryAfter)
}

function readRetryAfter(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const parameters = 'parameters' in error ? (error as { parameters?: unknown }).parameters : undefined
  if (typeof parameters !== 'object' || parameters === null || !('retry_after' in parameters)) return undefined
  const value = (parameters as { retry_after?: unknown }).retry_after
  return typeof value === 'number' && value > 0 ? value : undefined
}

function limitStream(body: ReadableStream<Uint8Array>, limit: number) {
  let read = 0
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      read += chunk.byteLength
      if (read > limit) throw new TelegramProviderError('Telegram file is too large')
      controller.enqueue(chunk)
    },
  }))
}
