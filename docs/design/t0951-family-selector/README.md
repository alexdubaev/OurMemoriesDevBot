# T-09.5.1 family selector reference freeze

`memoly-my-families-fullscreen.html` is the owner supplied visual and state extension for Family Hub, family context in the existing Feed, unread presentation, and the related navigation and warnings. It does not replace `docs/memoly-final-functional-state-pack.html` for the rest of memoLy. The static demonstration is not a production data or runtime contract.

## Frozen source

| Property | Value |
|---|---|
| File | `docs/design/t0951-family-selector/memoly-my-families-fullscreen.html` |
| SHA-256 | `2BDECFA840BE87F74F5F8C2CAFA3F02EE3FF2E5026F1A48F4AB6B05A8F067516` |
| Bytes | `16,594,043` |
| Encoding | Valid UTF-8; no BOM; no NUL bytes |
| EOL | LF only: 12,046 LF, 0 CRLF, 0 lone CR; final byte is LF |
| Checkout attribute | Exact path `-text` in root `.gitattributes` |
| Source | Owner attachment `1-memoly-my-families-fullscreen.html`; copied as bytes, without formatting or asset changes |

To verify after checkout:

```powershell
(Get-FileHash -Algorithm SHA256 docs/design/t0951-family-selector/memoly-my-families-fullscreen.html).Hash
(Get-Item docs/design/t0951-family-selector/memoly-my-families-fullscreen.html).Length
git check-attr text -- docs/design/t0951-family-selector/memoly-my-families-fullscreen.html
```

Expected hash and length are above; `git check-attr` reports `text: unset`. The older global canonical remains frozen at SHA-256 `180F8C9B6E60369513CFFD5EB9DBB3CB3397649407DF996DCF907AB0FA38C5B4`.

## Reading the file

The delivered file displays the final full canvas static review layer `#fhReviewStatic` by default (HTML lines 11949–12045). Its 14 native `:target` screens cover the main family and Feed examples. The earlier `#fhPrototype` is hidden and its script has inactive type `text/x-memoly-prototype-inactive` (lines 11588–11944). It contains the fuller FH/FF example catalog, but its personas, arrays, timers, local storage, inline SVG, routing, and fake counts are demonstration code only. The static scenario menu and theme controls are also review tooling, not product UI.

For the state inventory, React reuse, CSS target and B5/B6 split, see [T-09.5.1-FAMILY-UI-MIGRATION-MAP.md](../../mvp/tasks/T-09.5.1-FAMILY-UI-MIGRATION-MAP.md). `evidence/` contains unmodified viewport captures from this HTML at 390×844. Screenshots help compare composition; this HTML remains the source of visual truth.
