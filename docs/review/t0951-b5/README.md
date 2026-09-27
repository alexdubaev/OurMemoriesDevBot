# T-09.5.1-B5 visual evidence

These are production React components rendered with synthetic development-only fixtures. The fixture route exists only in Vite development builds. Capture command:

```bash
cd webapp
bunx playwright test -c visualtests/playwright.config.ts visualtests/family-hub.pw.ts
```

Frozen target: [Family selector reference](../../design/t0951-family-selector/memoly-my-families-fullscreen.html). Compare its `evidence/` captures at 390×844 with the React screenshots below. The React Hub keeps the reference's 480px shell, illustration/title overlap, card hierarchy, grouped sections, badges, footer and mobile spacing. The selected-family screenshot intentionally uses the existing production Feed rather than rebuilding the frozen Feed demo. A real child photo appears only when the production API provides a private avatar media ID; synthetic fixtures use the fallback avatar.

| State | React screenshot |
| --- | --- |
| Empty | [empty-390.png](empty-390.png) |
| One invited | [single-390.png](single-390.png) |
| Multiple invited | [multi-390.png](multi-390.png) |
| Owned and invited | [owned-390.png](owned-390.png) |
| Loading | [loading-390.png](loading-390.png) |
| List error | [error-390.png](error-390.png) |
| Long names / 99+ | [long-390.png](long-390.png) |
| Revoked access notice | [revoked-390.png](revoked-390.png) |
| Selected existing Feed | [selected-feed-390.png](selected-feed-390.png) |

Responsive captures: [320px](long-320.png), [430px](long-430.png), [768px](long-768.png). Theme captures: [mint](owned-mint.png), [rose](owned-rose.png), [sky](owned-sky.png), [lavender](owned-lavender.png), [apricot](owned-apricot.png), [sand](owned-sand.png).

The Playwright fixture also selects the family and returns to “Все семьи”. This confirms the visible transition; the live API path is covered separately in `webapp/e2e/specs/family.spec.ts`.
