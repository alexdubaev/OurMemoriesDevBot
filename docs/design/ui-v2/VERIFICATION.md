# Verification — MEMOLY-UI-V2-REACT-LAB

Date: 2 October 2026. Implementation model: GPT-6 (Codex).
Task base: 329d6b9ccb7616adc6c5c75d2781db62400a5f32.
Revision base: d9b1182f271fb40849f35eb4a922b1864b09c15c.
Branch: design/ui-v2-react-lab.
Worktree: D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/ui-v2-react-lab.
Current commit is recorded in the Draft PR. Status: owner cover artwork/visual approval pending.

| Check | Result | Exit |
|---|---|---|
| bun run --cwd webapp typecheck | Passed after final object-URL lifecycle change | 0 |
| bun run --cwd webapp lint | Passed after moving state updates out of the effect | 0 |
| bun run --cwd webapp build | 696 modules, Lab excluded; same production output | 0 |
| bun run architecture:check | 764 source files passed | 0 |
| bun run template:check | Tracked documentation/template check passed | 0 |
| git diff --cached --check | No whitespace errors | 0 |
| Playwright full suite | 24/24 passed, 1.4 minutes | 0 |
| Final cover/catalog/hero subset | 3/3 passed after object-URL lifecycle refinement | 0 |

The full suite mounts all 243 current catalog states without runtime errors, broken images or
horizontal overflow at 390px. Five color-only entries were removed by explicit owner direction.
It checks 12 groups, roles, child/profile edits, selected memory edits/deletion, reactions, viewers,
invite privacy/retry, overlay focus/restore, touch targets, reduced motion and primary contrast.
Responsive checks cover Feed/Family/Composer at 320/360/390/430/768px. 28 settled screenshots.
All browser cases assert zero page API requests. Source and dist guards check Lab isolation.
Four synthetic demo photographs fit the 180KB/photo budget; the new father/daughter image is 111834 bytes.

New cover test: local image changes artwork but not header dimensions/palette; survives Feed/Family
navigation; removing it restores the plain header. Local blobs are revoked on replacement/unmount.
The catalog file remains local to the tab; it is not uploaded and does not carry into a new clean-preview tab.
The full suite passed before the lifecycle lint fix; the affected 3-test subset then passed on the final code.
An initial geometry assertion compared page coordinates after auto-scroll; corrected to component dimensions.
The lint failure was fixed rather than suppressed.

Visual comparison: [design-qa](design-qa.md). The shared header is currently plain cream because
the owner is generating its artwork. Exact cover crop/text contrast remains pending those files.
This is not a claim that the blank header matches the supplied watercolor reference.
Prior independent review: [REVIEW](REVIEW.md); it does not cover this later visual revision.
No new review loop was started, following the owner's one-reviewer limit.

Changed boundaries: Lab source/assets, Lab tests and docs/design/ui-v2 only.
No production code/dependency/public asset, API contract, auth/cache, database schema or migration changes.
Private reference photos are not copied into Git. Generated pictures are fictional demo-only material.
PR #146 remains draft. No merge or deployment.
