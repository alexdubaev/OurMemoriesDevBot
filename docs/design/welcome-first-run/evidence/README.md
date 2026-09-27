# Welcome animation parity

These PNGs are direct Chromium screenshots from `webapp/visualtests/welcome-parity.pw.ts`, with CSS animations sought to the same elapsed source time. No image was edited or re-encoded. The test generates all 30 source/production frames and geometry metrics in `webapp/e2e/.artifacts/welcome-parity/`; this directory contains the key review frames.

| Elapsed | Frozen source, 390×844 | Production component, 390×844 |
| --- | --- | --- |
| 0 ms | [source](source-390x844-0.png) | [production](production-390x844-0.png) |
| 1050 ms | [source](source-390x844-1050.png) | [production](production-390x844-1050.png) |
| 2050 ms | [source](source-390x844-2050.png) | [production](production-390x844-2050.png) |
| 3050 ms | [source](source-390x844-3050.png) | [production](production-390x844-3050.png) |
| 4000 ms | [source](source-390x844-4000.png) | [production](production-390x844-4000.png) |

| Short/wide final frame | Frozen source | Production component |
| --- | --- | --- |
| 320×568, 4000 ms | [source](source-320x568-4000.png) | [production](production-320x568-4000.png) |
| 430×932, 4000 ms | [source](source-430x932-4000.png) | [production](production-430x932-4000.png) |

The approved interaction removal explains the visible differences: source Pause and CTA controls are absent in production, and the footer moves upward after CTA removal. The decorative hero composition and phase order are preserved. The automated comparison checks key element geometry within 3.5 CSS px, opacity within 0.03, no page scroll, and final footer visibility at 320×568.
