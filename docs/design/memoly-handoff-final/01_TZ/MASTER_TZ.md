# memoLy — MASTER ТЗ

## 1. Продукт

memoLy — приватный семейный архив воспоминаний о ребёнке.

Основные пользователи:
- родители;
- бабушки/дедушки;
- другие приглашённые родственники.

Главная ценность:
быстро сохранить семейный момент и дать близким смотреть/реагировать без сложного аккаунт-флоу.

---

# 2. Основные разделы

## 2.1 Лента

Содержит:
- общий ChildHeader;
- фильтры;
- воспоминания;
- fixed BottomNav.

Фильтры:
- Все
- Фото
- Видео
- Голос
- Заметки

Карточка воспоминания:
- author avatar/name;
- occurred time;
- `...`;
- media/content;
- like;
- comments;
- bookmark/secondary action визуально допустим только если product logic подтверждена;
- caption;
- liked-by / social context;
- comments entry.

## 2.2 Добавить

Открывается через центральную кнопку BottomNav.

Один shared BottomSheet.

Действия:
- Фото
- Заметка
- Голос или видео — файл с устройства

Не делать:
- запись видео внутри memoLy;
- запись голоса внутри memoLy.

## 2.3 Семья

Содержит:
- тот же базовый ChildHeader;
- settings overlay только здесь;
- child/profile affordance;
- список участников;
- role badges;
- member actions;
- invite;
- usage/archive;
- privacy/help.

## 2.4 Настройки

Через settings в Family.

Меню:
- Оформление
- Помощь и приватность
- О memoLy

Не переносить старый dashboard-settings как UI memoLy.

## 2.5 Оформление

6 тем:
- Мята
- Роза
- Небо
- Лаванда
- Абрикос
- Песок

Переключение мгновенное.
Preference хранится локально / в выбранном user-preference слое.

---

# 3. Роли и права

Backend/API capabilities — источник истины.

MemoryDto содержит:
- `capabilities.edit`
- `capabilities.delete`
- `capabilities.like`

UI не должен угадывать право по названию роли, если capability уже пришла от API.

## Viewer
- смотрит;
- likes/comments если capability позволяет;
- no Add;
- no Delete;
- BottomNav center показывает viewing/locked state по production decision.

## Full
- Add;
- Delete если capability true;
- остальные owner/full operations по backend.

## Owner
Owner — family-level факт (`isOwner`), не отдельный визуальный глобальный режим.
Family management использует реальные backend permissions/actions.

---

# 4. Memory Actions

Нажатие `...`:
shared BottomSheet:
- Подробнее — всегда;
- Удалить воспоминание — только `memory.capabilities.delete === true`.

Не показывать `Редактировать`, пока это не соответствует production flow.

---

# 5. Delete

После `Удалить воспоминание`:

1. Actions sheet закрывается.
2. Открывается `MemoryDeleteSpotlight`.
3. exact selected memory рендерится React-представлением.
4. background dim + blur.
5. original Feed card остаётся в layout, но `visibility:hidden`.
6. confirm panel непосредственно под preview:
   - `Удалить это воспоминание?`
   - `Оно исчезнет из семейной ленты.`
   - Отмена
   - Удалить
7. Pending:
   - no double-submit;
   - accidental dismiss blocked.
8. Error:
   - spotlight остаётся;
   - memory preview остаётся;
   - `Не удалось удалить воспоминание. Попробуйте ещё раз.`
9. Success:
   - existing mutation/query state удаляет memory;
   - overlay закрывается.

Никакого `cloneNode`, hash-driven delete или ручного DOM remove.

---

# 6. Media

## Photo
Использовать existing private media + PhotoSwipe flow.

## Video
Не строить новый player.

Существующие варианты:
- private video;
- Telegram video handoff;
- MAX video stream.

MAX:
- backend playbackPath;
- standard HTML5 video;
- Range/stream semantics должны сохраняться.

## Voice
Использовать существующие:
- media source;
- playback coordinator;
- waveform logic.

---

# 7. Comments

Визуальный паттерн:
- Instagram-like;
- comments привязаны к memory;
- author;
- time;
- body;
- input;
- reply visual state при наличии product support.

Если backend comments ещё не реализован полностью — не выдумывать API.

---

# 8. Theme Art

Header artwork уникален для темы, но base ChildHeader геометрия неизменна.

Mapping:
- Mint → garden/leaves/flowers/dragonfly
- Rose → balloons/rainbow/stars/hearts
- Sky → clouds/airplane/kite
- Lavender → moon/clouds/stars
- Apricot → sun/hills/hot-air balloon/birds
- Sand → sea/sailboat/paper boat/shells

Assets лежат в `06_ASSETS/theme-header/web/`.

---

# 9. Responsive

Primary target:
- mobile / embedded MAX / Telegram webview;
- width roughly 320–480px.

Rules:
- one-column;
- no horizontal page overflow;
- filters may horizontally scroll only if necessary;
- media never blows viewport;
- bottom nav respects host insets;
- no fake statusbar.

---

# 10. Accessibility

- minimum interactive target ≈44px;
- dialogs use semantic primitives;
- focus returns to trigger;
- destructive confirmation labelled;
- theme artwork is decorative `aria-hidden`;
- reduced motion respected;
- screen-reader names on icon-only buttons.

---

# 11. Static prototype

`11_VISUAL_REFERENCE/memoly-visual-reference.html`

Authority:
- visual composition;
- style;
- spacing;
- shape;
- component skin.

NOT authority:
- data fetching;
- mutations;
- permissions;
- navigation state;
- media backend;
- security.
