# Recommended Migration Order

## Phase 0 — protect current behavior
Before visual migration:
- run existing feed tests;
- run contracts;
- capture baseline;
- do not change backend.

## Phase 1 — Foundations
1. theme tokens
2. brand asset
3. WebP theme art
4. surface primitives
5. shared page width/insets

## Phase 2 — Global components
1. ChildHeader
2. BottomNavigation skin
3. MemolyBottomSheet
4. PageHeader
5. tactile buttons/fields

## Phase 3 — Feed
1. filters
2. memory cards
3. action row
4. memory actions sheet
5. memory detail
6. delete spotlight
7. comments visual layer if backend-ready

## Phase 4 — Add
Reskin existing flow without changing backend/media behavior.

## Phase 5 — Family
1. shared ChildHeader
2. members
3. invite
4. usage
5. settings

## Phase 6 — Appearance
6 themes + persistence.

## Phase 7 — QA
320 / 390 / 430 / 480 widths.
MAX / Telegram / browser host insets.
FULL / VIEWER.
Media permutations.

## Rule

At every phase:
behavior tests must keep passing before proceeding.
