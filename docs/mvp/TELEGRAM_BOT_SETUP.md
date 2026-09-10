# Telegram-бот проекта · development/pilot

## 1. Зарегистрированный бот
Для разработки и закрытого пилота уже создан отдельный Telegram-бот:

- **Отображаемое имя:** `Наши воспоминания • Test`
- **Username:** `@OurMemoriesDevBot`
- **Публичная ссылка:** `https://t.me/OurMemoriesDevBot`
- **Назначение:** development / закрытый пилот MVP. Не считать его будущим production-брендом.

**Не создавать второго development-бота без решения владельца.** Код должен проверять, что переданный секретный токен действительно относится к ожидаемому username `OurMemoriesDevBot`.

## 2. Что является секретом
Реальный bot token, webhook secret, production credentials, signed media URL и любые будущие API-ключи **не входят в ТЗ, ZIP, Git, issue, PR, screenshot или логи**.

В документации фиксируются только имена переменных и публичные значения. Секреты владелец передаёт процессу через локальный `.env` либо secret store хостинга.

Если token когда-либо попал в Git, лог, скриншот или публичный чат, считать его скомпрометированным и перевыпустить через BotFather; простого удаления строки из последнего commit недостаточно.

## 3. Нормативные переменные окружения
Использовать следующий контракт. Шаблон лежит в `../../templates/telegram/backend.env.example`.

```dotenv
# public/config
TELEGRAM_BOT_EXPECTED_USERNAME=OurMemoriesDevBot
TELEGRAM_BOT_MODE=polling
TELEGRAM_WEBHOOK_URL=
TELEGRAM_MINI_APP_URL=

# secrets — values NEVER commit
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_INBOX_ENCRYPTION_KEY=
```

### Правила
- `TELEGRAM_BOT_EXPECTED_USERNAME` хранится в Git: это публичная конфигурация.
- `TELEGRAM_BOT_TOKEN` — секрет BotFather. Только server-side.
- `TELEGRAM_WEBHOOK_SECRET` — отдельная случайная строка минимум 32 байта энтропии; не равна bot token.
- `TELEGRAM_INBOX_ENCRYPTION_KEY` — отдельный base64url-ключ из 32 случайных байт для AES-256-GCM durable inbox; не равен другим секретам.
- `TELEGRAM_WEBHOOK_URL` появляется после получения HTTPS-домена backend.
- `TELEGRAM_MINI_APP_URL` появляется после HTTPS-деплоя webapp.
- Локально допускается `TELEGRAM_BOT_MODE=polling`; в staging/production использовать `webhook`.
- Не передавать bot token в browser bundle, HTML, initData response, client DTO или URL.

## 4. Проверка правильного токена при запуске
До регистрации webhook/polling backend вызывает Bot API `getMe` и проверяет:

1. ответ успешен;
2. `result.username === TELEGRAM_BOT_EXPECTED_USERNAME`;
3. возвращённый numeric `result.id` используется как фактический `bot_id` для dedupe/source keys;
4. mismatch → fail-fast, никаких webhook/config изменений.

**Numeric bot ID вручную в ТЗ не нужен.** Он получается из `getMe` по секретному токену и не должен вычисляться клиентом. Это уменьшает риск случайно запустить проект с токеном другого бота.

## 5. Настройки BotFather для MVP
До появления HTTPS Mini App достаточно зарегистрированного бота. Для MVP:

- не отключать privacy ради групповых чатов;
- группы в продукте не поддерживаются; если BotFather показывает `Allow Groups`, выключить добавление в группы для development-бота;
- не подключать Payments;
- не создавать production-бота;
- не настраивать Mini App URL до появления проверенного HTTPS webapp;
- не публиковать token в документации.

Профиль/команды лучше применять повторяемым config-скриптом после реализации блока 04, а не полагаться только на ручные настройки BotFather.

## 6. Команды MVP
После реализации блока 04 config-скрипт должен идемпотентно настроить:

- `/start` — начать / открыть семейную ленту или приглашение;
- `/app` — открыть Mini App;
- `/help` — помощь по фото, видео, голосовым и заметкам;
- `/privacy` — открыть политику;
- `/cancel` — отменить активный запрос подписи.

Служебные команды никогда не публикуются как `Memory`.

## 7. Menu button / Main Mini App
Когда есть проверенный `TELEGRAM_MINI_APP_URL` по HTTPS:

1. staging сначала связывается с тестовым webapp;
2. config-скрипт настраивает menu button / Web App URL;
3. после проверки на Telegram iOS и Android владелец разрешает пилотный URL;
4. изменение URL логируется как конфигурационная операция, не требует изменения продуктовой логики.

URL не должен содержать bot token или пользовательский секрет.

## 8. Webhook
Production-like окружение использует webhook:

- endpoint: `/webhooks/telegram` либо фактический путь из `REPO_MAP`;
- `setWebhook` вызывается только отдельной управляемой командой/config-скриптом;
- передаётся `secret_token`, а webhook handler сравнивает `X-Telegram-Bot-Api-Secret-Token`;
- webhook устанавливается только после readiness backend;
- dry-run показывает target URL, allowed updates и username, но никогда не печатает token/secret;
- rollback умеет удалить/заменить webhook без удаления бота.

Локальная разработка может использовать polling, чтобы не требовать публичного tunnel. Polling и webhook не запускаются одновременно.

## 9. Что владелец делает вручную
Сейчас уже выполнено: бот создан как `@OurMemoriesDevBot`.

Перед живой интеграцией владелец один раз помещает token в локальный секретный `.env`/secret store. Агент не просит вставить token в Markdown, prompt или GitHub issue. Если агенту нужен доступ к секрету в среде выполнения, он использует уже настроенную environment variable и в отчёте пишет только `configured/not configured`.

## 10. Критерий готовности интеграции
Development-бот считается корректно подключённым только когда:

- `getMe` подтверждает `@OurMemoriesDevBot`;
- token отсутствует в Git history и frontend bundle;
- локальный polling либо staging webhook получает synthetic update;
- повтор update идемпотентен;
- `/start` и `/help` не создают воспоминание;
- Mini App кнопка появляется только после валидного HTTPS URL;
- выключение/замена webhook не затрагивает сохранённые семейные данные.
