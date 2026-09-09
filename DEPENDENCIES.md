# Dependency registry

## Selected runtime

| Dependency | Source | Use in MVP | License / note |
| --- | --- | --- | --- |
| Bun 1.4.0 | Vibe lockfile | Workspace runtime and package manager | Version recorded in `.bun-version` and `package.json` |
| Hono | Vibe lockfile | Backend HTTP transport | Existing template dependency |
| Prisma / PostgreSQL | Vibe lockfile / Docker Compose | Database access and local test database | PostgreSQL 18 remains required by the upstream UUIDv7 schema |
| React / Vite | Vibe lockfile | Telegram Mini App web client | Existing template dependency |
| Zod | Vibe lockfile | Shared public contracts | Existing template dependency |
| Sharp 0.35.4 | npm, pinned workspace override | Decode ordinary images and create metadata-free WebP derivatives | Apache-2.0; native libvips build |
| heic-decode 2.1.0 | npm | Decode real HEVC/HEIC input when the bundled libvips build cannot render HEIC | ISC; libheif-js/WASM fallback |
| @ffprobe-installer/ffprobe 2.1.2 | npm | Bounded codec, duration, and dimensions probe before video/voice publication | LGPL/GPL FFmpeg build; exact platform binary selected by lockfile |

## Deliberately not added

No Expo, Capacitor, VK, AI SDK, payment SDK, Telegram SDK, heavy media-player library, or new cloud SDK is added in Block 00. A future dependency requires a concrete block-level need and review.
