# First-run welcome source freeze

`memoly-welcome-final-ios.html` is the owner-approved immutable animation reference. The file was copied byte for byte from the supplied attachment; do not format or edit it. Production markup and scoped CSS live in `webapp/src/features/welcome/`.

| Property | Value |
| --- | --- |
| Bytes | 779815 |
| SHA-256 | `ea2969128a6856d59e0d1bfb698c8185cb3a89a3776acd24e3b57bcebc496c8c` |
| Encoding / line endings | UTF-8, LF |
| Embedded images | 14 WebP references, 9 unique byte streams |

`scripts/derive-welcome-css.mjs` scopes the source CSS and removes only demo interaction styles. The static WebP files in `webapp/public/assets/welcome/` contain the original decoded bytes, with no image conversion.
