# Зафиксированные решения — НЕ ПЕРЕСМАТРИВАТЬ БЕЗ ЯВНОГО ЗАПРОСА

## 1. Визуальный язык

memoLy — мягкий tactile/neumorphic интерфейс.

Ключевой эффект:
- элемент одновременно выглядит слегка **выдавленным** и **вдавленным**;
- светлая верхняя/левая грань;
- мягкая тёмная нижняя/правая глубина;
- внутренние тени на inset-поверхностях;
- это НЕ просто `border-radius + box-shadow`.

Никакой декоративной мишуры за пределами интерфейса.

## 2. Нейтральность

Приложение для воспоминаний и мальчиков, и девочек.

Базовый дизайн — гендерно нейтральный.
Розовый — только одна из вручную выбираемых тем.

**Никогда:** `girl => pink`, `boy => blue`.

## 3. Главная навигация

Всегда один BottomNav:
- Лента
- Добавить
- Семья

Версия-источник — та, что была принята на экране `Семья`.

Никакой второй версии BottomNav для Feed.

## 4. ChildHeader

Feed и Family используют одну базовую геометрию ChildHeader.

Не должны двигаться при переключении:
- logo;
- avatar;
- child name;
- child age.

В Family могут добавляться только overlays/extensions:
- settings;
- profile affordance;
- family-specific content ниже base header.

В Feed settings-кнопки нет.

## 5. Системный status bar

Не рисовать внутри приложения:
- часы;
- Wi‑Fi;
- signal;
- battery.

Это host/browser/iOS chrome.

## 6. Feed

Паттерн близок к Instagram:
- автор;
- дата/время;
- media;
- like/comments/actions;
- caption;
- social context.

Фото/видео — нормальная мобильная портретная подача, не киношный wide-first layout.

## 7. Add

В приложении НЕТ собственного:
- camera video recording;
- voice recording.

Добавляем:
- Photo;
- Note;
- Voice or Video file from device/gallery.

## 8. Playback

Не строить новый видеоплеер memoLy.

Сохранять существующие:
- HTML5 `<video>`;
- MAX streaming pipeline;
- Telegram handoff;
- PhotoSwipe;
- existing voice playback/waveform.

## 9. Invite

MVP:
- отправили ссылку;
- родственник открыл;
- присоединился к семье.

Без обязательного логина/пароля для бабушек/дедушек.

## 10. BottomSheet

Один shell:
- backdrop;
- blur;
- panel;
- radius;
- handle;
- safe-area.

Разное только содержимое:
- Add;
- Settings;
- Memory Actions.

Delete confirmation — НЕ BottomSheet.

## 11. Delete UX

При удалении выбранное воспоминание должно оставаться визуальным контекстом.

Production:
- selected memory sharp/centered;
- rest blurred/dimmed;
- confirm непосредственно под memory preview;
- original source card `visibility:hidden`, чтобы лента не прыгала;
- controlled React state;
- no DOM clone;
- no hash trick.

## 12. Themes

6 тем:
- Mint
- Rose
- Sky
- Lavender
- Apricot
- Sand

Theme меняет:
- semantic colors;
- micro accents;
- ChildHeader artwork.

Theme НЕ меняет:
- layout;
- geometry;
- permissions;
- component tree;
- media behavior.

## 13. Theme artwork

Только ImageGen / raster artwork.

Не рисовать:
- SVG scenes;
- CSS-art scenes;
- программные иллюстрации.

Production format: WebP.
