# Bin-Addressed Storage — Design

**Date:** 2026-07-12

## Goal

Make the bin the primary physical address for every part. A part lives at `{box_id}-{bin_number}` (e.g. `B9-1` = box B9, bin 1). Box IDs are printed on box lids; bin numbers are printed on bin compartments. Part-level labels and barcode scanning are removed entirely — a part is found by reading its address in the app, then reading the printed box and bin numbers on the shelf.

## Current state

- `parts.location` is free text (`B1`, `RED`, `REEL`), not a foreign key.
- `parts.bin_number` is nullable. NULL means "unplaced" — the storage grid synthesizes a display position by filling empty slots in `item_code` order. That position is not stored, so it is not a stable address.
- `parts.barcode` holds `location-item_code`; `/scan` scans it; `/labels` prints part stickers.
- Sharing exists: multiple parts may share one `(location, bin_number)`.

## Data model

### `parts`

- **Drop** `barcode` column (hard drop — no data preserved).
- `location` becomes `NOT NULL`, FK → `boxes(id)`.
- `bin_number` becomes `NOT NULL`, with `CHECK (bin_number >= 1)`.
- No unique constraint on `(location, bin_number)` — bins are shareable by design.
- The address `B9-1` is derived in the UI from `location` and `bin_number`. It is not a stored column.

### `boxes`

Unchanged: `id`, `bin_count`, `rows`, `cols`.

`bin_count` is the physical truth — how many compartments the box actually has. A part with `bin_number > bin_count` is **out of range**: allowed to exist (the audit shows real data in this state), flagged in the UI, and correctable by the user. It is never blocked at write time.

### `REELS`

Parts stored loose on their own reels, not in a binned box. Modeled as an ordinary box `REELS` whose bin numbers are a logical auto-increment counter (1..N), never physically printed. The 3 parts currently at location `REEL` merge into `REELS`.

## Audit of production data (2026-07-12)

223 parts. **Zero parts with NULL location.** 49 parts have an explicit `bin_number`.

| box | parts | distinct bins needed | bin_count | note |
|---|---|---|---|---|
| B1 | 2 | 2 | 10 | ok |
| B3 | 15 | 15 | 15 | full |
| B4 | 15 | 15 | 15 | full |
| B5 | 14 | 14 | 15 | ok |
| B6 | 34 | 30 | 30 | full |
| B7 | 39 | 36 | 30 | needs 6 over capacity |
| B8 | 33 | 31 | 30 | needs 1 over capacity |
| B9 | 49 | 30 | 30 | one part already sits at bin 31 |
| RED | 11 | 11 | 9 | needs 2 over capacity |
| REEL | 3 | 3 | — | **no `boxes` row** — merges into REELS |
| REELS | 6 | 6 | 10 | ok |
| SANDBOX | 2 | 2 | 25 | ok |
| B10 | 0 | — | 20 | empty |

Overflow is expected: bins may already be shared physically, or emptied and reallocated. The migration assigns numbers past `bin_count` rather than guessing; the user corrects them in the UI afterward.

## Migration

Single SQL migration. Data is fixed before constraints are applied, so it cannot half-fail.

1. `UPDATE parts SET location = 'REELS' WHERE location = 'REEL'` (3 rows).
2. Insert a `boxes` row for any distinct `location` lacking one (none expected after step 1 — a safety net).
3. Auto-assign bins. Per box, in `item_code` order: parts with an explicit `bin_number` keep it; each part with NULL takes the lowest bin number not yet claimed in that box, counting past `bin_count` if it runs out.
4. Raise `REELS.bin_count` to at least its part count (9).
5. `ALTER TABLE parts ALTER COLUMN location SET NOT NULL`, add FK to `boxes(id)`.
6. `ALTER TABLE parts ALTER COLUMN bin_number SET NOT NULL`, add `CHECK (bin_number >= 1)`.
7. `ALTER TABLE parts DROP COLUMN barcode`.

## Removals

- `/scan` page and `src/components/qr-scanner.tsx`.
- `getPartByBarcode()` in `src/lib/actions.ts`.
- `sharebin()` in `src/lib/actions.ts` — sharing is now expressed by typing the same bin number.
- `src/components/label-grid.tsx` (part label sheets).
- `barcode` from `Part` type, `part-form`, `part-card`, `/import`, and the `getParts()` search filter.
- The auto-fill placement logic in `box-grid.tsx` — bin position now comes from the data.

## UI

### `/labels` — box and bin sticker printing

Two printable sheets, no part labels:

- **Box labels** — one large box id per box, for the lid. Reuses the existing `box-label-grid.tsx`.
- **Bin number stickers** — for a selected box, the numbers `1..bin_count` laid out in that box's `rows × cols` grid, sized for compartment floors.

### `/storage` — box grid

- A bin slot renders the parts whose `bin_number` equals that slot. No synthesized positions.
- A slot with two or more parts keeps the existing shared (amber) treatment.
- Below each grid, an **out-of-range strip** lists parts whose `bin_number` exceeds the box's `bin_count`, styled as a warning and linking to the part editor. The box header shows the count of such parts.

### `part-form`

- **Box** — a select populated from `boxes`. Required.
- **Bin** — a number input. Required. If the value exceeds the box's `bin_count`, show an inline warning ("outside box capacity (30)") but still allow saving.
- Below the bin input, a live line naming the other parts already in that bin, so sharing a bin is a visible consequence of the number you typed rather than a separate checkbox flow.
- The barcode display field and the entire share-a-bin checkbox/select block are removed.

### `part-card`

The barcode line is replaced by a `B9-1` address badge. The existing "Shared with: …" line is kept.

### `/import`

Imported parts require a box and bin. New parts default to the next free bin in the last-used box; the assignment is shown in the review step before insert.

## Testing

- Migration: run against a local copy of the production dump; assert every part has a box and bin, that no explicit bin assignment was overwritten, and that no two auto-assigned parts in a box collide.
- `box-grid`: given parts with explicit bins including a duplicate and an out-of-range one, the grid places each at its number, marks the duplicate shared, and lists the out-of-range part in the strip.
- `part-form`: submitting without a bin fails validation; an over-capacity bin warns but saves; a bin already in use shows its occupants.
