# Interaction & Behavior Spec

## Feed navigation

### Feed tab
Scroll/feed state persists where reasonable.

### Family tab
Switches main section without moving base ChildHeader geometry.

### Add
FULL role only.
Viewer uses existing locked/view-only center state.

---

# Memory `...`

Tap:
1. store selected memory;
2. open `MemolyBottomSheet`;
3. return focus to same trigger on close.

Rows:
- Подробнее
- Удалить воспоминание if `capabilities.delete`.

---

# Delete spotlight

Detailed production contract:

```text
more
→ actions sheet
→ Delete
→ close sheet
→ deleteTarget = memory
→ spotlight modal open
```

Background:
- blur 10px;
- dim ~45–50%.

Selected source:
```css
visibility: hidden;
```

Preview:
- React render;
- non-interactive;
- max-width ≈420px / 92vw;
- max-height ≈60dvh;
- centered.

Confirmation:
- immediately below preview.

Mutation:
reuse existing `useMemoryDelete`.

On error:
- overlay remains;
- inline error;
- source remains hidden because preview still supplies context.

On success:
- close after mutation resolves;
- query mutation/invalidation owns list update.

---

# Theme selection

Tap theme card:
- updates app root theme attribute/state;
- colors change;
- header image changes;
- layout must not move.

No refresh.

---

# Family invite

Create invite:
- optional family alias;
- Viewer / Full access;
- generated one-time link;
- Copy / Share.

Join UX is link-first.

---

# Media

Photo:
existing PhotoSwipe.

Telegram video:
existing poster/handoff flow.

MAX:
existing `<video>` pipeline.

Voice:
existing waveform/playback.

No custom replacement players.

---

# Back behavior

Sheets:
- Back closes current sheet.

Spotlight:
- Back/escape cancels if not submitting.

Pending destructive request:
- prevent accidental dismiss.

---

# Errors

Use inline/local error state near action that failed.

Do not replace screen with generic error unless existing loading/error contract requires it.

Delete:
`Не удалось удалить воспоминание. Попробуйте ещё раз.`
