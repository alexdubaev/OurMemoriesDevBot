import { writeFileSync, mkdirSync } from 'node:fs'
import { catalog } from '../../src/dev/ui-v2/states/catalog'
import { tokens } from '../../src/dev/ui-v2/tokens/design-tokens'
const docs = new URL('../../../docs/design/ui-v2/', import.meta.url)
mkdirSync(docs, { recursive: true })
const intro = `# Screen matrix — fresh main inventory

Task: MEMOLY-UI-V2-REACT-LAB. Base: 329d6b9ccb7616adc6c5c75d2781db62400a5f32.
Inventory completed before screen implementation. Source of truth: active App.tsx composition and imports.
One row is one catalog state. Role is independently selectable; overlays open on a real parent surface.
UI Lab states model presentation, never backend/provider execution.

| UI v2 screen/state | Current production component/path | Назначение | Role | Data state | Interaction | Implemented |
|---|---|---|---|---|---|---|
`
writeFileSync(new URL('SCREEN_MATRIX.md', docs), intro + catalog.map(e => `| ${e.id} | ${e.source} | ${e.purpose} | ${e.role} | ${e.state} | ${e.interaction} | NO |`).join('\n') + `

## Intentional exclusions and boundary decisions

- Template routes in routes.tsx (password login/signup/reset, admin/users dashboards) are not mounted by current App.tsx/main.tsx. They are inherited Vibe examples, not memoLy product screens; not redesigned.
- MAX runtime diagnostic panel is a developer diagnostic, not a user surface.
- No recorder: AddSheetPresentation routes voice to the bot. Lab shows the same explanatory handoff without opening the host.
- FamilyArchivePage is storage usage, not a new gallery/navigation section.
- Local playback state is simulated: no media engine/provider requests.
- Permission rules reproduce current UI: owner edits child/family and roles/removes; full can invite/edit alias/create memories; viewer reads/reacts; owner cannot leave.
- Incoming invite exposes no private photo before explicit Join.
- Installed/dismissed PWA cases have no production prompt; Lab renders an explanatory preview of its absence.
- One fixed palette and replaceable raster profile covers (latest owner decision).
`)
writeFileSync(new URL('../../src/dev/ui-v2/tokens/design-tokens.json', import.meta.url), JSON.stringify(tokens, null, 2) + '\n')
console.log(`Inventory: ${catalog.length} states registered (NO until verification).`)
