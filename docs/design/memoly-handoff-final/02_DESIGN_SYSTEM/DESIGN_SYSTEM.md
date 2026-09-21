# memoLy Design System

## Core visual language

Soft tactile / neumorphic.

### Raised surface
Use:
- bright top-left highlight;
- soft low-contrast shadow;
- warm/neutral surface gradient;
- subtle inset highlight.

### Inset surface
Use:
- inner dark top/left or bottom/right depth depending primitive;
- inner light counter-shadow;
- surface must appear carved into same material.

### Avoid
- flat Material cards;
- harsh gray box-shadow;
- black outlines;
- glassmorphism everywhere;
- pure white cards on pure gray canvas.

---

# Geometry

Recommended token family:

```css
--layout-max-width: 480px;
--radius-card: 28px;
--radius-sheet: 32px;
--radius-field: 20px;
--touch-target: 44px;
```

Do not hardcode values independently per feature if shared token exists.

---

# Typography

Use existing `Typography` component.

Do not introduce arbitrary font-size classes when an existing memory typography variant fits.

Visual hierarchy:
- child name = strong hero;
- page title = strong;
- section heading = medium/strong;
- metadata = muted;
- caption = readable, not tiny.

---

# BottomNav

One component.

Positions:
1. Feed
2. Add
3. Family

Active state uses theme accent.
Center Add is circular elevated control.

On narrow/mobile screens:
- fixed to viewport bottom;
- respect `--host-inset-bottom`;
- content gets bottom padding so last card is fully reachable.

---

# ChildHeader

Same DOM/composition Feed + Family.

Frozen:
- logo coordinates;
- child avatar;
- name;
- age;
- art frame dimensions.

Family-only:
- settings;
- profile chevron/affordance;
- optional extension below base header.

Feed:
- no settings.

Header artwork:
- absolute decorative layer;
- never changes layout;
- object-cover crop;
- text/avatar are above it.

---

# BottomSheet

One shell:

```text
Overlay
└─ Panel
   ├─ Handle
   └─ Content
```

Common:
- backdrop blur;
- dim;
- 32px-ish top radius;
- max 480px;
- safe-area;
- focus/dismiss behavior.

Variants are content only:
- action list;
- add grid;
- settings list.

---

# Memory Card

Same family of surfaces as rest of app.

Structure:
- author row;
- media;
- actions;
- caption/social context.

`...` touch target = 44×44 minimum.

Cards must not become generic flat post cards.

---

# Color semantics

Do not code `mint` directly in feature components.

Use semantic tokens:
- canvas;
- surface;
- surface-raised;
- surface-inset;
- accent;
- accent-deep;
- accent-soft;
- text;
- text-muted;
- danger;
- shadow;
- glow.

Micro accents follow Theme:
- date dot;
- active like;
- comments action;
- family count;
- active nav;
- active filter.

Neutral:
- core navy/dark text;
- inactive bookmark;
- destructive red;
- memoLy brand logo.

---

# Artwork rule

Functional icons:
existing WebP icon system is allowed/preferred.

Decorative scenes:
ImageGen raster only.
No SVG/CSS illustration recreation.
