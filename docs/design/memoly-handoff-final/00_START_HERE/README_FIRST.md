# memoLy — FINAL UI/UX HANDOFF PACKAGE

Это полный пакет передачи интерфейса memoLy следующему агенту.

## Главный принцип

**Статический HTML — визуальный эталон.
React-код репозитория — источник истины для данных, permissions, media и backend-поведения.**

Нельзя делать наоборот:
- не переносить статический hash/JS-мок как production-логику;
- не заменять реальные query/mutation/media flows поведением из prototype;
- не упрощать принятый дизайн до обычных белых карточек с box-shadow.

## Читать в таком порядке

1. `01_TZ/MASTER_TZ.md`
2. `00_START_HERE/LOCKED_DECISIONS.md`
3. `02_DESIGN_SYSTEM/DESIGN_SYSTEM.md`
4. `03_COMPONENTS/COMPONENT_CONTRACTS.md`
5. `04_INTERACTIONS/INTERACTION_SPEC.md`
6. `05_THEMES/THEME_SYSTEM.md`
7. `08_REPO_MAP/IMPLEMENTATION_MAP.md`
8. `09_QA/ACCEPTANCE_CHECKLIST.md`
9. `10_AGENT_PROMPT/MASTER_AGENT_PROMPT.md`

## Визуальный эталон

`11_VISUAL_REFERENCE/memoly-visual-reference.html`

Он нужен для сверки:
- геометрии;
- рельефа;
- размеров;
- spacing;
- нижней навигации;
- bottom sheet;
- header;
- тем.

Интерактивность prototype не является production-контрактом.

## Assets

### Brand
`06_ASSETS/brand/`

Использовать:
- `memoly-logo-correct.webp`
- `memoly-ly-mark.webp`

PNG лежат рядом как мастер-источники.

### Theme Header Art
`06_ASSETS/theme-header/`

Для каждого из 6 оформлений:
- `original/*.png` — исходник ImageGen;
- `web/*.webp` — оптимизированный production asset.

**Декоративные изображения темы не рисовать SVG/CSS.**

### UI Icons
`06_ASSETS/icons/`

Это текущий WebP icon-system репозитория.

## Production references

`07_REACT_REFERENCE/`

Это reference API/архитектура, не обязательный copy-paste.

## Что агент не должен делать

- менять согласованный layout;
- возвращать fake iOS status bar;
- добавлять запись видео/голоса из приложения;
- привязывать розовую/голубую тему к полу ребёнка;
- создавать новый кастомный видеоплеер;
- дублировать BottomSheet по фичам;
- дублировать BottomNav;
- рисовать theme-art SVG;
- терять delete capabilities/backend semantics;
- заменять existing MAX/Telegram/private media paths.
