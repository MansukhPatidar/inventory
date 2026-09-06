# Order Format Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third recognized format ("order-table" / 3-line stanza per item) to the Add Parts paste parser, auto-detected, with a small low-confidence flag in the queue UI.

**Architecture:** All changes live inside `src/app/parts/new/page.tsx`. We extend the existing classifier in `parsePastedText` with a new branch (`parseOrderTableFormat`) that fires when an order-table signal is present, and we widen the `QueuedPart` interface with an optional `lowConfidence` boolean rendered as an amber dot in the queue list. No new files, no schema changes, no new dependencies.

**Tech Stack:** Next.js 16 (static export), React 19, TypeScript, Tailwind. Verification is manual in the browser dev server — there is no test framework in this repo, and the spec accepts that.

**Spec:** `docs/superpowers/specs/2026-04-28-order-format-classifier-design.md`

---

## File Structure

Single file modified:

- `src/app/parts/new/page.tsx`
  - Around line 25–34: extend `QueuedPart` interface with `lowConfidence?: boolean`
  - Around line 36–96: add new constants and the `parseOrderTableFormat` function alongside existing `INLINE_QTY_RE`, `SKIP_LINE_RE`, `parseInlineQtyFormat`, `parseTabularFormat`
  - Around line 97–113: update `parsePastedText` to dispatch order-table first
  - Around line 599–626: render an amber dot in the queue row when `lowConfidence` is true

No other files touched.

---

## Task 1: Add `lowConfidence` to the `QueuedPart` interface

**Files:**
- Modify: `src/app/parts/new/page.tsx:25-34`

- [ ] **Step 1: Add the optional field to the interface**

Find the `QueuedPart` interface and add `lowConfidence?: boolean`:

```ts
interface QueuedPart {
  id: string;
  item_code: number;
  item_name: string;
  package: string;
  location: string;
  details: string;
  qty: number;
  barcode: string;
  lowConfidence?: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`

Expected: build succeeds. Existing call sites that construct `QueuedPart` literals without `lowConfidence` continue to work because the field is optional.

(If `npm run build` is too slow during iteration, `npx tsc --noEmit` is the equivalent type-check.)

- [ ] **Step 3: Commit**

```bash
git add src/app/parts/new/page.tsx
git commit -m "feat: add lowConfidence flag to QueuedPart"
```

---

## Task 2: Add detection regexes and the order-table parser

**Files:**
- Modify: `src/app/parts/new/page.tsx` — insert new constants and function in the parser section (after `parseTabularFormat`, before the `// --- Component ---` divider near line 269)

- [ ] **Step 1: Add the order-table regexes**

Place these constants near the top of the parser section, immediately after the existing `SKIP_LINE_RE` declaration (around line 95):

```ts
// Order-table format (Robu paste): 3-line stanza per item.
// Optional header line: "Product   Qty   Unit Price   Total"
const ORDER_TABLE_HEADER_RE =
  /^\s*Product\s+Qty\s+Unit\s*Price\s+Total\s*$/i;
// SKU line: "SKU: <alphanumeric>"
const SKU_LINE_RE = /^SKU:\s*(\S+)\s*$/i;
// Qty/price line: "<int>   ₹ <dec>   ₹ <dec>"
// Whitespace between columns is variable. Currency symbol can be ₹, $, €, etc.
const ORDER_QTY_LINE_RE =
  /^(\d+)\s+[₹$€£¥]\s*[\d.,]+\s+[₹$€£¥]\s*[\d.,]+\s*$/;
```

The currency-class is widened beyond ₹ so future Mouser/AliExpress pastes don't accidentally fail detection — costs nothing and keeps the regex honest.

- [ ] **Step 2: Add the `parseOrderTableFormat` function**

Insert this function immediately after `classifyColumnsHeuristic` (around line 267, before the `// --- Component ---` divider):

```ts
function parseOrderTableFormat(
  lines: string[],
  startCode: number,
  location: string
): QueuedPart[] {
  // Drop the header line if present.
  let body = lines;
  if (body.length > 0 && ORDER_TABLE_HEADER_RE.test(body[0])) {
    body = body.slice(1);
  }

  const parts: QueuedPart[] = [];
  let code = startCode;
  let i = 0;

  while (i < body.length) {
    const nameLine = body[i];
    const skuLine = body[i + 1];
    const qtyLine = body[i + 2];

    // Stanza must be a triple where line 2 is "SKU:" and line 3 matches the qty pattern.
    // If shape doesn't match, skip one line and retry — keeps us resilient to stray blank
    // lines or notes between stanzas.
    if (
      !skuLine ||
      !qtyLine ||
      !SKU_LINE_RE.test(skuLine) ||
      !ORDER_QTY_LINE_RE.test(qtyLine)
    ) {
      i++;
      continue;
    }

    const qtyMatch = qtyLine.match(ORDER_QTY_LINE_RE);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) || 0 : 0;

    const item_name = nameLine.trim();
    let pkg = "";
    const pkgMatch = item_name.match(PKG_RE);
    if (pkgMatch) pkg = pkgMatch[0].toUpperCase();

    const lowConfidence = qty === 0 || item_name.length < 5;

    const barcode = location ? `${location}-${code}` : "";

    parts.push({
      id: crypto.randomUUID(),
      item_code: code,
      item_name,
      package: pkg,
      location,
      details: item_name,
      qty,
      barcode,
      lowConfidence: lowConfidence || undefined,
    });
    code++;
    i += 3;
  }

  return parts;
}
```

The `lowConfidence: lowConfidence || undefined` collapses `false` to `undefined` so unflagged items don't carry the property — keeps the queue objects clean.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`

Expected: build succeeds. The function isn't wired in yet but it must type-check on its own.

- [ ] **Step 4: Commit**

```bash
git add src/app/parts/new/page.tsx
git commit -m "feat: add order-table format parser"
```

---

## Task 3: Wire the order-table parser into `parsePastedText`

**Files:**
- Modify: `src/app/parts/new/page.tsx:97-113`

- [ ] **Step 1: Add detection signal helpers above `parsePastedText`**

Insert immediately above the existing `parsePastedText` function (around line 97):

```ts
function looksLikeOrderTable(lines: string[]): boolean {
  // Strong signal: explicit Robu header on the first non-empty line.
  if (lines.length > 0 && ORDER_TABLE_HEADER_RE.test(lines[0])) {
    return true;
  }
  // Fallback signal: at least one SKU line followed (within 2 lines) by a qty/price line.
  // We require both signals together to avoid false positives on tabular pastes that
  // happen to contain an "SKU:" cell.
  for (let i = 0; i < lines.length - 1; i++) {
    if (!SKU_LINE_RE.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      if (ORDER_QTY_LINE_RE.test(lines[j])) return true;
    }
  }
  return false;
}
```

- [ ] **Step 2: Update `parsePastedText` to dispatch order-table first**

Replace the existing `parsePastedText` body. The function currently looks like:

```ts
function parsePastedText(
  text: string,
  startCode: number,
  location: string
): QueuedPart[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Check if this is "name × qty" format (inline quantity)
  const inlineMatches = lines.filter((l) => INLINE_QTY_RE.test(l));
  if (inlineMatches.length >= lines.filter((l) => !SKIP_LINE_RE.test(l)).length * 0.5) {
    return parseInlineQtyFormat(lines, startCode, location);
  }

  // Otherwise: tabular format
  return parseTabularFormat(lines, startCode, location);
}
```

Replace with:

```ts
function parsePastedText(
  text: string,
  startCode: number,
  location: string
): QueuedPart[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Order-table (Robu) format takes priority — it's the most specific shape.
  if (looksLikeOrderTable(lines)) {
    return parseOrderTableFormat(lines, startCode, location);
  }

  // "name × qty" inline quantity format.
  const inlineMatches = lines.filter((l) => INLINE_QTY_RE.test(l));
  if (inlineMatches.length >= lines.filter((l) => !SKIP_LINE_RE.test(l)).length * 0.5) {
    return parseInlineQtyFormat(lines, startCode, location);
  }

  // Fallback: tabular format (header-detected or column-heuristic).
  return parseTabularFormat(lines, startCode, location);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 4: Browser verification — order-table paste**

```bash
npm run dev
```

Open http://localhost:3000/parts/new in a browser. Click **Paste order**. Paste the canonical sample (with header):

```
Product    Qty    Unit Price    Total
Two Trees MGN15H Linear Guide Rail - 0.5M with Sliding block
SKU: 503440
1    ₹ 1768    ₹ 1768
SL9500M33SE-Slkor-500mA 60dB@(1kHz) Fixed 3.3V Positive electrode 6V SOT-23-5 Voltage Regulators - Linear, Low Drop Out (LDO) Regulators ROHS
SKU: R192894
50    ₹ 3.54    ₹ 177
TS-1103S-HANBO-12mm 4.3mm 50mA Round Button Standing paste 12mm SPST 100MΩ 250gf 12V SMD,12x12mm Tactile Switches ROHS
SKU: R196104
100    ₹ 2.3    ₹ 230
SI2301-ZE-HXY MOSFET-20V 2.3A 700mW 140mΩ@4.5V,2A 700mV 1 P-Channel SOT-23 MOSFETs ROHS
SKU: R248317
100    ₹ 1.9    ₹ 190
Piezo Buzzer 15mm
SKU: 1555078
5    ₹ 14    ₹ 70
TSC009A1526B-BZCN-5.15mm 1.5mm 50mA 5.15mm 100,000 Times 12V 260gf SMD-5P,5.1x5.1mm Tactile Switches ROHS
SKU: R181153
10    ₹ 1.2    ₹ 12
```

Click **Add to queue**. Expected:
- Toast: "Added 6 parts to queue"
- Queue shows 6 items (not 18)
- Item 1: `Two Trees MGN15H Linear Guide Rail - 0.5M with Sliding block`, qty 1
- Item 2 (SL9500M33SE…) shows `SOT-23-5` package badge, qty 50
- Item 3 (TS-1103S…) shows `SMD` package badge, qty 100
- Item 4 (SI2301-ZE…) shows `SOT-23` package badge, qty 100
- Item 5 (Piezo Buzzer 15mm), no package, qty 5
- Item 6 (TSC009A1526B…) qty 10

- [ ] **Step 5: Browser verification — paste WITHOUT header**

In the same dialog, paste the same sample but with the first line (`Product    Qty    Unit Price    Total`) removed. Expected: same 6 queue items.

- [ ] **Step 6: Browser verification — pre-existing inline-qty still works**

Paste:

```
LM2596 DC-DC Step Down × 5
INA226 Power Sensor × 10
```

Expected: 2 queue items, qty 5 and 10. (Confirms the order-table branch didn't steal the inline-qty case.)

- [ ] **Step 7: Browser verification — pre-existing tabular still works**

Paste:

```
Product Name	Quantity	Package
LM7805	10	TO-220
NE555	25	DIP-8
```

Expected: 2 queue items with the correct packages. (Confirms the tabular fallback still fires.)

- [ ] **Step 8: Commit**

```bash
git add src/app/parts/new/page.tsx
git commit -m "feat: classify order-table paste format on Add Parts"
```

---

## Task 4: Render the low-confidence dot in the queue list

**Files:**
- Modify: `src/app/parts/new/page.tsx:599-626` (the queue row's name + metadata block)

- [ ] **Step 1: Add the amber dot before the item name**

Find this block (around line 608–617):

```tsx
<div className="flex items-center gap-2">
  <span className="font-medium truncate group-hover:text-primary transition-colors">
    {part.item_name}
  </span>
  {part.package && (
    <Badge variant="secondary" className="text-[11px] font-mono shrink-0">
      {part.package}
    </Badge>
  )}
</div>
```

Replace with:

```tsx
<div className="flex items-center gap-2">
  {part.lowConfidence && (
    <span
      aria-label="Low confidence — review before saving"
      title="Low confidence — review before saving"
      className="shrink-0 inline-block h-2 w-2 rounded-full bg-amber-500"
    />
  )}
  <span className="font-medium truncate group-hover:text-primary transition-colors">
    {part.item_name}
  </span>
  {part.package && (
    <Badge variant="secondary" className="text-[11px] font-mono shrink-0">
      {part.package}
    </Badge>
  )}
</div>
```

The `title` attribute gives a hover tooltip on desktop without adding a new component. `aria-label` keeps it accessible.

- [ ] **Step 2: Browser verification — flag fires**

Restart the dev server if needed (`npm run dev`). On `/parts/new`, paste a stanza with an unparseable qty line so `qty === 0` triggers the flag:

```
Product    Qty    Unit Price    Total
Mystery Component
SKU: X1
abc    ₹ 5    ₹ 5
```

Note: this paste will NOT be detected as order-table, because `abc` doesn't match `ORDER_QTY_LINE_RE` and so neither detection signal fires. To confirm the flag itself renders, instead paste a real stanza but watch a short-name case:

```
Product    Qty    Unit Price    Total
Cap
SKU: X1
1    ₹ 1    ₹ 1
```

Expected: 1 queue item with name `Cap`, qty 1, AND an amber dot to the left of the name (because `item_name.length < 5`).

- [ ] **Step 3: Browser verification — flag does NOT fire on normal items**

Re-paste the canonical 6-item sample from Task 3 Step 4. Expected: NO amber dot on any of the 6 rows (all names ≥ 5 chars, all qtys > 0, including `Piezo Buzzer 15mm`).

- [ ] **Step 4: Commit**

```bash
git add src/app/parts/new/page.tsx
git commit -m "feat: show low-confidence dot on flagged queue rows"
```

---

## Task 5: End-to-end verification on a queue save

**Files:** none modified — verification only.

- [ ] **Step 1: Save the canonical sample to the real database**

With dev server running, paste the 6-item canonical sample on `/parts/new`. Set the **Location** field to a test box (e.g., `B99`) before pasting so barcodes get assigned. Click **Save 6 parts**.

Expected:
- Saving modal shows progress 6/6
- Success toast: "Saved 6 parts"
- Redirect to `/`
- The 6 new parts appear in the parts list with sequential item codes, location `B99`, correct qtys

- [ ] **Step 2: Spot-check one part's stored fields**

Click into one of the saved parts (e.g., the SL9500M33SE one). Expected:
- `item_name` = full original first line (with " ROHS" tail intact)
- `details` = same as `item_name`
- `package` = `SOT-23-5`
- `qty` = 50
- No SKU stored anywhere

- [ ] **Step 3: Clean up the test data**

Delete the 6 test parts created in Step 1 from the parts list (or via the Supabase dashboard) so the verification doesn't leave noise. If the user prefers to keep them, skip this step.

- [ ] **Step 4: Final smoke test of the build**

Run: `npm run build`

Expected: completes without TypeScript errors. The static export in `out/` is what GitHub Pages will deploy on push.

---

## Done

After all tasks pass:

- 4 commits on the branch (one per Task 1–4; Task 5 is verification-only)
- Push to `master` triggers `.github/workflows/deploy.yml` → live at https://mansukhpatidar.github.io/inventory/ in ~1 minute

No follow-up work outstanding for this feature.
