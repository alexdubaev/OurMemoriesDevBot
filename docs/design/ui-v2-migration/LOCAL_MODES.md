# Local UI versions and frontend rollback

The live application has one set of controllers, API contracts and stored data. The build flag
selects presentation. Existing preference IDs select cover artwork in v2; they do not select a
palette or a UI version.

From this worktree in PowerShell, build the new presentation:

```powershell
$env:VITE_MEMOLY_UI_VERSION = 'v2'
bun run --cwd webapp vite build --outDir e2e/.artifacts/builds/v2
```

Build the retained presentation from the same source:

```powershell
$env:VITE_MEMOLY_UI_VERSION = 'legacy'
bun run --cwd webapp vite build --outDir e2e/.artifacts/builds/legacy
Remove-Item Env:VITE_MEMOLY_UI_VERSION
```

The omitted/invalid flag resolves to legacy. A Vite environment variable is compiled into the
bundle; changing an environment variable on an already built server does not change that bundle.
Use separate output directories and artifact identities. These are local build commands, not
deployment instructions.
Both outputs stay in the ignored local artifact directory; neither enters the product source.

For development preview, set the desired flag before starting Vite; restart Vite to switch modes.
Keep synthetic test data and private storage isolated from the production bot and families.

Before an owner-approved release, retain the compatible legacy frontend artifact and
record the source revision, mode and bundle checksum. Returning to that artifact changes the
interface without restoring the database or deleting memories. Confirm API compatibility and
browser asset-cache handling in the release procedure. Never overwrite an existing production
SHA image with a different UI-mode build. The Selectel Dockerfile forwards this flag with
`legacy` as its fallback; the canonical Selectel builder explicitly supplies `v2` for the
owner-approved release. Its SHA-tagged image always has the mode selected in that source
revision, rather than an operator-controlled mode under an existing image tag.

For the UI-only release, the current legacy image and a compressed Docker archive are retained
on the server. The reviewed Selectel `redeploy.sh rollback-static` action restores the saved
frontend image under the host deployment lock. It validates image identity, lineage and exact
backend/contracts/dependency/config compatibility; backend, jobs, data and gateway stay running.
Use the [Selectel runbook](../../../deploy/selectel/README.md) and the recorded release evidence.
Do not use the full application rollback to change only presentation.

Shared styling lives in `webapp/src/styles/tokens.css` and
`webapp/src/components/ui-v2/shared-skin.css`. Shared controls live in
`webapp/src/components/ui-v2/`. Change semantic tokens or shared control variants there;
screen styles should arrange content rather than define another palette.
