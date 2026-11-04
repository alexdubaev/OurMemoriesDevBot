<!-- autopilot:progress -->
# memoLy — альбомные истории: обсуждения и акварель

Текущая сборка: `.autopilot/2026-11-04-memoly-albums-watercolor-social--wip/`. Сервер, общий social adapter и четыре внутренних экрана реализованы. Одно независимое review без подтверждённых P0/P1/P2 и clean-clone social3/3 пройдены. Первый FULL выявил public-import boundary; адресное исправление проверено. Затем закрыты Bun JSX scanner и реальные glob/minimatch audit blockers; affected checks пройдены, final source rebind/recovery proof выполняются. Финальный FULL/merge/release ещё выполняются; это не отчёт об успешном выпуске.

## Договорились — не пересматривать

- 2026-11-04 — «Докер и образы перенесены на диск D; всё необходимое искать и делать на D». Ubuntu VHD подтверждён в D:/WSL/Ubuntu; native Linux working files тоже на D.

- Обсуждаем AlbumEntry: все ракурсы одной работы используют одно обсуждение; обсуждения ленты и разных историй разделены.
- Подлинная акварель первого варианта PR270; полный безопасный reference и assets — commit1906f549. Каталог и пять пунктов навигации сохраняются.
- Owner/Full/Viewer с действующим членством могут обсуждать историю; только Owner модерирует чужие комментарии, чужой текст никто не редактирует.
- Одна задача, ветка и implementation PR, один общий выпуск. Никаких промежуточных production этапов.
- Владелец разрешил точечное дополнение recovery guard для двух album-social миграций и точного итогового source. Backup, S3, locks и запрет отката БД сохраняются.
- Старые записи wishlist/children/Control из предыдущего PROGRESS были историческими снимками; accepted main a3b128a3 уже содержит принятые функции. Эти независимые задачи не возобновляются.

## Не доделано

- Завершить итоговый canonical FULL на исправленном чистом source, squash merge и guarded deploy/smoke; факты публикуются в PR и внешнем HANDOFF.
- Физический iPhone/MAX: клавиатура/safe-area/Back, pinch и возврат к плитке остаются ручной проверкой; desktop/CDP не являются device acceptance.

## Известные баги

— Подтверждённые projection500 при одном файле в двух историях и legacy-clear resurrection исправлены и проверены реальной PostgreSQL. Итоговое review ещё впереди.

## Правки без автопилота

—
