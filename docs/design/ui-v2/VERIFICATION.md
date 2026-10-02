# Verification — MEMOLY-UI-V2-REACT-LAB

Base: `329d6b9ccb7616adc6c5c75d2781db62400a5f32`.
Branch: `design/ui-v2-react-lab`.
Task worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/ui-v2-react-lab`.

Final verification completed on 2 October 2026 after resolving both review findings.
Implementation model: GPT-6 (Codex); independent scoped reviewer: GPT-6-luna/high.
The committed final head is recorded in the Draft PR and owner handoff; `git rev-parse HEAD` identifies it locally.

| Command | Result | Exit |
|---|---|---|
| `bun run --cwd webapp typecheck` | TypeScript project build passed; also repeated inside final build | 0 |
| `bun run --cwd webapp lint` | ESLint passed after review fixes | 0 |
| `bun run --cwd webapp build` | Production build passed, 696 modules; Lab not bundled | 0 |
| `bun run architecture:check` | 764 source files passed | 0 |
| `bun run template:check` | Tracked documentation links/template checks passed | 0 |
| `bunx playwright test --config e2e/ui-v2/playwright.config.ts` (webapp) | 23/23 passed, 1.7 minutes | 0 |
| Review regression subset | 5/5 passed; both new regressions first reproduced failure before fixes | 0 |
| Final screenshot subset (`--grep screenshot`) | 6/6 passed, 9 seconds; animations fast-forwarded for settled visual evidence | 0 |
| `git diff --cached --check` | No whitespace errors | 0 |

The browser suite mounts all 248 registered states with no uncaught runtime exception, broken image
or horizontal overflow at 390px. It checks 12 groups, all six themes, shared hero geometry, role gates,
navigation, carousel, one active reaction, long press, note publishing/cancellation, selected memory
editing/deletion, selected participant role/alias updates, child identity/date consistency, invite
privacy/retry, overlay focus/restore, reduced motion and primary-action contrast (at least 4.5:1).
Feed/Family/Composer are checked at 320/360/390/430/768px. 26 loaded-image screenshots are committed.
Visual inspection covers photo Feed, Family, welcome and composer; screenshots remain available for owner judgement.

All 23 browser tests record zero page requests to `/api`; interception fails any attempted API use.
The dedicated server has no API proxy and rejects API/storage paths. A source guard rejects transport,
production feature/platform imports and host sharing/clipboard APIs. The production dist guard proves
no imported Lab assets or Lab runtime/CSS sentinels are present. Existing production output is unchanged.
No new dependency or existing production file is changed. JSON tokens and three demo-photo budgets are checked.

Earlier failures were resolved rather than reported as passes: modal Escape/focus, button text contrast,
an overly broad dist-path assertion, a select locator and screenshots captured before image decoding.
The dedicated server ignores Playwright trace HTML to prevent test artifacts triggering page reloads.

Independent review and resolutions: [REVIEW](REVIEW.md). Technical review is not owner design approval.

Only the allowed Lab source, dedicated entry/config, tests and design documentation are changed.
No production runtime, backend, schema, contract, dependency or existing public asset is modified.
Synthetic fixtures reset on reload; external actions are simulated and do not mutate production data.

The age fixture uses 2 October 2026, matching the synthetic album date, for reproducible screenshots.
Chromium checks validate local browser presentation. Native implementations and provider engines are outside this review.
