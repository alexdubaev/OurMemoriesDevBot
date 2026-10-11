# UIM-01 — начало переноса в приложение

Task: MEMOLY-UI-V2-PRODUCTION-MIGRATION / UIM-01, 2026-10-02.
Lead: Codex / GPT-6. Worker: uim01_header_worker / gpt-6-luna.
Status: REVIEW (implementation, lead checks and two fresh technical reviews passed; owner acceptance remains later).
Branch: feat/ui-v2-production-migration.
Worktree: D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/ui-v2-production-migration.
Base: 329d6b9ccb7616adc6c5c75d2781db62400a5f32.
Review HEAD: 329d6b9ccb7616adc6c5c75d2781db62400a5f32 plus the full assigned UIM-01 diff.
Local task commit follows these checks/reviews; exact final HEAD is recorded in the delivery message and Git log.
PR: не опубликовано; main не изменён.

## Выполнено

- План полного переноса: [PLAN.md](PLAN.md); архитектура и выпуск: [SPEC.md](SPEC.md).
- ChildHeader переключает только представление, сохраняя реальные props/callbacks/ChildAvatar.
- Новый модуль features/ui-version с публичным входом; build flag принимает v2, иначе legacy.
- Новый components/ui-v2: шапка, стили и таблица шести обложек.
- public/assets/ui-v2: шесть оптимизированных обложек владельца, новая прозрачная шестерёнка
  WebP 48/72px для отображения 24px, manifest с хешами/размерами/происхождением.
- tests/ui-version.test.ts и ui-v2-header.test.tsx: выбор режима, совместимость старого вывода,
  реальные имя/возраст/URL/crop, доступные элементы управления и отсутствие settings без callback.

## Проверено ведущим

| Проверка | Результат |
|---|---|
| Baseline theme/design-system/feed | 91 tests, 578 assertions, 3 files, exit 0 |
| Те же suites + ui-version/ui-v2-header | 95 tests, 600 assertions, 5 files, exit 0 |
| bun run --cwd webapp typecheck | exit 0 |
| bun run --cwd webapp lint | exit 0 |
| bun run architecture:check | 738 source files, exit 0 |
| bun run template:check | exit 0 |
| VITE_MEMOLY_UI_VERSION=v2: webapp build + build contracts | build exit 0; 2 tests, exit 0 |
| Flag absent (legacy): webapp build + build contracts | build exit 0; 2 tests, exit 0 |
| Manifest vs actual WebP files | 8 hashes/bytes/dimensions match; icon alpha range 0–255; exit 0 |
| Lead Playwright header matrix + callbacks | 18/18 (6 covers × 320/390/430px), exit 0; back/settings/profile callbacks passed |
| git diff --check | exit 0 |

Первичная архитектурная ошибка импорта исправлена публичным index.ts.
Иконки 1706 и 2764 bytes; обложки суммарно 161562 bytes. Все ниже бюджетов.
Production build contracts подтверждают отсутствие существующих dev fixtures в bundle.

## Визуальный контроль

Временная игнорируемая Vite HTML fixture монтирует настоящий ChildHeader с production.css;
синтетические имя и аватар-заглушка не входят в приложение.
Скриншоты: [bunny 390](screenshots/header-bunny-390.png), [moon 320](screenshots/header-moon-320.png),
[moon 390](screenshots/header-moon-390.png), [moon 430](screenshots/header-moon-430.png).
Ведущий просмотрел bunny 390 и moon 320. Исправлены перекрытие кнопки/логотипа и кадрирование зайца.
Иконка проверена в реальном размере 24px, touch target 44px.
Ведущий отдельно выполнил браузерную матрицу всех шести обложек с host insets 20/16/26px:
нет горизонтального overflow и перекрытий, логотип по центру, avatar 84px, gear 24px/target 44px.
Проверочные скрипт/логи сохранены локально среди игнорируемых e2e artifacts.
Worker сообщил первоначальный red run до создания модулей: оба новых test files падали на отсутствующих импортах.

## Независимое ревью

- uim01_review / gpt-6-luna: findings [] на полном активном UIM-01 diff; 95 tests / 600 assertions,
  typecheck/lint/architecture/diff-check прошли. Исправлений не потребовалось.
- uim01_confirmation_review / gpt-6-luna, новый контекст: findings [] на всём staged изменении,
  включая roadmap; два новых test files, хеши/bytes восьми assets и staged diff-check прошли.
- Оба результата относятся к первому блоку, не к готовности всего UI или разрешению выпуска.

## Ограничения и следующий блок

Перенесена только общая шапка. Полная лента, навигация, карточки, media и остальные экраны ещё
не перенесены; этапы UIM-02…06 записаны отдельно. В ленте пока нет settings callback, поэтому новая
шапка не выдумывает действие настроек. Общая палитра и оболочка относятся к UIM-02.
Нет миграций, изменений API/auth/ролей/схемы, новых зависимостей или hosting credentials.
Preview-hosting не создан; адрес/runtime/auth предстоит определить перед фактической публикацией.
Rollback сейчас — оставить production как есть и выбрать legacy для сборки preview. После принятия
и выпуска используется совместимый прежний frontend artifact или новый rollback commit; БД не откатывается.
Следующий назначаемый блок: UIM-02. Не запускать автоматически новый блок или production-деплой.
