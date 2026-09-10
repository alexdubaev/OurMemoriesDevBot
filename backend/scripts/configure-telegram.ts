import 'dotenv/config'

import { loadEnv } from '../src/env'
import { verifyTelegramBotIdentity } from '../src/modules/auth'
import { createTelegramApi, telegramConfigSummary } from '../src/modules/telegram'

const env = loadEnv(Bun.env)
const summary = telegramConfigSummary(env)
console.log('Telegram bot config:', summary)

if (!process.argv.includes('--apply')) {
  console.log('Dry run only. Pass --apply to configure commands and an already-approved Mini App menu URL.')
  process.exit(0)
}
if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured')
await verifyTelegramBotIdentity({ token: env.TELEGRAM_BOT_TOKEN, expectedUsername: env.TELEGRAM_BOT_EXPECTED_USERNAME })
const api = createTelegramApi(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_FILE_MAX_BYTES)
await api.setCommands([
  { command: 'start', description: 'Начать и открыть семейную ленту' },
  { command: 'app', description: 'Открыть Mini App' },
  { command: 'help', description: 'Как сохранять воспоминания' },
  { command: 'privacy', description: 'Приватность' },
  { command: 'cancel', description: 'Отменить запрос подписи' },
])
if (env.TELEGRAM_MINI_APP_URL) await api.setMenuButton(env.TELEGRAM_MINI_APP_URL)
console.log('Telegram commands configured. Webhook was not changed.')
