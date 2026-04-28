# Order Format Classifier — Design

**Date:** 2026-04-28
**Scope:** Add Parts page (`src/app/parts/new/page.tsx`) — "Paste order" dialog

## Problem

The Add Parts page already has a "Paste order" feature with a parser that supports two formats:

1. Inline qty: `Product Name × 5`
2. Tabular: tab- or multi-space-delimited columns, with optional header row

When a user pastes a Robu order — which is the most common real-world case — neither parser fits. The Robu paste shape is a flattened table where each item spans **three lines** (name / `SKU: <code>` / `<qty> ₹<unit> ₹<total>`), preceded by an optional header line. The current parser treats every line as a separate row and produces ~3× as many queue items as actual order items, all with garbage fields.

## Goal

Add a third recognized format ("order-table") to the existing parser, auto-detected, that correctly parses Robu-style pastes into one queue item per order line. Fall back to the existing parsers when the order-table shape isn't present.

## Sample input

```
Product    Qty    Unit Price    Total
Two Trees MGN15H Linear Guide Rail - 0.5M with Sliding block
SKU: 503440
1    ₹ 1768    ₹ 1768
SL9500M33SE-Slkor-500mA 60dB@(1kHz) Fixed 3.3V Positive electrode 6V SOT-23-5 Voltage Regulators - Linear, Low Drop Out (LDO) Regulators ROHS
SKU: R192894
50    ₹ 3.54    ₹ 177
Piezo Buzzer 15mm
SKU: 1555078
5    ₹ 14    ₹ 70
```

The header line is optional — users sometimes copy without it. SKU prefix varies (numeric like `503440`, or `R`-prefix like `R192894`). Product names range from terse (`Piezo Buzzer 15mm`) to dense LCSC-style strings.

## Detection

The parser becomes a **classifier** that picks one of three branches based on the input shape:

1. **Order-table** (new): if either signal holds —
   - first non-empty line matches `/^\s*Product\s+Qty\s+Unit\s*Price\s+Total\s*$/i`, OR
   - the body contains repeated `^SKU:\s*\S+$` lines paired with `^\d+\s+₹\s*[\d.]+\s+₹\s*[\d.]+$` lines in a 3-line cadence
2. **Inline qty** (existing): ≥ 50% of non-skip lines match `INLINE_QTY_RE`
3. **Tabular** (existing fallback)

Detection is checked in that order. The first match wins.

## Field extraction (order-table)

For each 3-line stanza:

| Part field   | Source                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| `item_name`  | line 1, unmodified                                                     |
| `details`    | same as `item_name` (existing convention in the codebase)              |
| `package`    | first match of existing `PKG_RE` against line 1; empty if no match     |
| `qty`        | first integer on line 3                                                |
| `item_code`  | sequential, allocated by existing `nextCode + queue.length` mechanism  |
| `location`   | from the form's location field, same as other paste paths              |
| `barcode`    | `<location>-<item_code>` if location set, same as other paste paths    |

The `SKU: <code>` line is **discarded**. Robu's SKU is not stored anywhere on the Part — keeping it would add a field that nothing else in the app uses, and the user can re-derive it by searching the order if needed.

## Low-confidence flag

Each parsed queue item gets a `lowConfidence: boolean` field. It is set when **either** of:

- `qty === 0` (couldn't parse the qty line)
- `item_name.trim().length < 5` (suspiciously short)

The earlier draft also flagged on "no package extracted AND name lacks digits/hyphens", but that produced false positives on legitimate short names like "Piezo Buzzer 15mm" — the heuristic added noise without catching real problems. Drop it.

UI: in the queue list (around `src/app/parts/new/page.tsx:599`), low-confidence rows show a small amber dot (4–5px) before the item name. No tooltip, no separate section, no review modal — clicking the row still opens the existing edit dialog where the user can fix things.

The flag is purely cosmetic. Saving works the same way; the user is the final filter.

## Out of scope

- Storing the order SKU on the Part (no schema change)
- Cleaning the `item_name` (stripping " ROHS", category tails) — the user wants the inventory to match what they see on the order
- A new preview/review screen — the existing queue + edit dialog covers this
- Other vendor formats (Mouser, Digikey, AliExpress) — not needed yet; the pattern set up here can be extended later

## Files touched

- `src/app/parts/new/page.tsx`
  - Add `parseOrderTableFormat(...)` function alongside the existing `parseInlineQtyFormat` / `parseTabularFormat`
  - Update `parsePastedText` to detect order-table first
  - Add `lowConfidence?: boolean` to `QueuedPart`
  - In the queue render, add the amber dot when `lowConfidence` is true

No schema changes, no new components, no new files.

## Testing

Manual verification on the dev server with the canonical Robu paste:

1. With header line — should produce 6 queue items from the 18-line sample
2. Without header line — same result (fallback signal still triggers)
3. Mixed paste (Robu order followed by inline-qty lines) — order-table wins, the extra lines are dropped (this is acceptable; users don't mix in practice)
4. Pre-existing inline-qty pastes (`Product × 5`) — still work
5. Pre-existing tabular pastes — still work
6. Low-confidence flag: `Piezo Buzzer 15mm` should NOT flag (qty 5, name length 17). A stanza where the qty line fails to parse, or where the name is < 5 chars, SHOULD flag.

The dev server is the verification surface — there are no unit tests in this project today, and adding a test harness for one parser function is out of scope.
