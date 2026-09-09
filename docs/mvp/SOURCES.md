# Первичные источники · проверка 09.09.2026
Распределение задач, лимиты пилота, Git-стратегия и бюджеты графики — решения для этого проекта, не гарантии сторонних сервисов. Источники подтверждают соответствующие механизмы. Доступность моделей и правила площадок перепроверяются перед запуском.

| ID | Источник | Что проверять |
|---|---|---|
| V1 | https://github.com/di-sukharev/vibe | Шаблон и лицензия; ранее исследованный SHA f2731e02547fb1118e233c99c47b4ec7c5fc8ba6 |
| T1 | https://core.telegram.org/bots/api | getFile, webhook, Message, file_id, caption |
| T2 | https://core.telegram.org/bots/webapps | initData, back/viewport/safe areas |
| T3 | https://telegram.org/tos/bot-developers | Ограничения хранения и обязанности оператора |
| G1 | https://grammy.dev/ | Бот, обработчики, интеграции |
| G2 | https://grammy.dev/guide/deployment-types | Webhook / polling |
| P1 | https://photoswipe.com/ | Lightbox и renderer hooks |
| P2 | https://github.com/dimsemenov/PhotoSwipe | Исходники и MIT |
| U1 | https://ui.shadcn.com/ | Готовые primitives, не продуктовые права |
| U2 | https://github.com/shadcn-ui/ui | Исходники/лицензия |
| A1 | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | Контраст |
| W1 | https://developers.google.com/speed/webp/docs/using | WebP tooling |
| Git1 | https://git-scm.com/docs/git-worktree | Изолированные worktrees |
| Git2 | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches | Защиты main, проверки и PR |
| Git3 | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax | CI triggers/conditions; сверить актуальный URL перед настройкой |
| O1 | https://developers.openai.com/codex/guides/agents-md | Имя AGENTS.md и контекст инструкций |
| O2 | https://openai.com/index/gpt-5-6/ | Названия семейств Luna/Terra/Sol |

Наличие текста этой процедуры не означает фактическую настройку GitHub. Код Vibe здесь не запускался. Реальные runtime, библиотеки, CLI и версии закрепляются при baseline этапа00.
