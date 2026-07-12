# Bin-Addressed Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `{box}-{bin}` (e.g. `B9-1`) the required, stored physical address of every part; print box IDs on lids and bin numbers on compartments; remove part barcodes, part labels, and QR scanning.

**Architecture:** A new pure module `src/lib/bins.ts` holds all bin arithmetic (assignment, occupancy, out-of-range detection) so it can be unit-tested without a database and reused by the migration script, the storage grid, and the part forms. A SQL migration backfills `bin_number` for all 223 existing parts using the same algorithm, then makes `location` and `bin_number` NOT NULL and drops `parts.barcode`. UI work then flows from the data model: the storage grid stops synthesizing bin positions and reads them, the part forms gain a required box+bin picker, and the labels page swaps part-label printing for bin-number sticker sheets.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Supabase (`@supabase/supabase-js`, anon key, RLS allow-all), TypeScript, Tailwind v4, shadcn-style UI primitives in `src/components/ui/`, `qrcode` for label QR codes. Tests: Vitest (added in Task 1 — the repo currently has no test framework).

## Global Constraints

- A part's address is `${location}-${bin_number}`, e.g. `B9-1`. It is **derived in code, never stored as a column**.
- `parts.location` and `parts.bin_number` are both `NOT NULL` after the migration. Every part has a box and a bin.
- Bins are **shareable**: multiple parts may hold the same `(location, bin_number)`. There is **no unique constraint** on that pair.
- `boxes.bin_count` is physical truth. A part whose `bin_number > bin_count` is **out of range**: it is legal to store, is flagged in the UI, and is **never blocked at write time**. The only hard rule is `bin_number >= 1`.
- `parts.barcode` is hard-dropped. No code may reference `part.barcode` after Task 8.
- The `REEL` location merges into `REELS`. `REELS` is an ordinary box whose bin numbers are a logical counter (never physically printed).
- Supabase credentials live in `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Migrations are applied with `npx supabase db push` (project is already linked to `cbdpwcrpvaglspphiljf`).
- Run `npx tsc --noEmit` after every UI task. It must be clean before commit.

---

### Task 1: Bin arithmetic module + test setup

The migration, the storage grid, and both part forms all need the same three answers: which bin is free, who else is in a bin, and is this bin out of range. Build that once, as pure functions over plain data, and unit-test it. This task also introduces Vitest, which the repo does not yet have.

**Files:**
- Create: `src/lib/bins.ts`
- Create: `src/lib/bins.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add `vitest` devDependency and `test` script)

**Interfaces:**
- Consumes: `Part` and `Box` from `src/lib/types.ts` (Task 8 removes `barcode` from `Part`; until then `bins.ts` must not reference `barcode`, so it is unaffected).
- Produces:
  - `formatAddress(location: string, binNumber: number): string`
  - `binOccupants<T extends BinnedPart>(parts: T[], location: string, binNumber: number): T[]`
  - `isOutOfRange(binNumber: number, binCount: number): boolean`
  - `nextFreeBin(parts: BinnedPart[], location: string): number`
  - `assignBins<T extends AssignablePart>(parts: T[]): Map<number, number>`
  - `type BinnedPart = { location: string | null; bin_number: number | null }`
  - `type AssignablePart = { id: number; item_code: number; location: string | null; bin_number: number | null }`

- [ ] **Step 1: Add Vitest**

```bash
npm install --save-dev vitest
```

Then add the `test` script to `package.json` — the `scripts` block becomes:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`. The `@/` alias must resolve the same way it does in `tsconfig.json`, or the test file cannot import `@/lib/types`.

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Write the failing tests**

Create `src/lib/bins.test.ts`. These cases encode every rule the rest of the plan depends on — most importantly that `assignBins` never moves a part that already has an explicit bin, and that it counts past `bin_count` rather than failing.

```typescript
import { describe, it, expect } from "vitest";
import {
  formatAddress,
  binOccupants,
  isOutOfRange,
  nextFreeBin,
  assignBins,
} from "./bins";

const part = (
  id: number,
  item_code: number,
  location: string | null,
  bin_number: number | null
) => ({ id, item_code, location, bin_number });

describe("formatAddress", () => {
  it("joins box and bin with a hyphen", () => {
    expect(formatAddress("B9", 1)).toBe("B9-1");
  });
});

describe("isOutOfRange", () => {
  it("is false when the bin fits the box", () => {
    expect(isOutOfRange(30, 30)).toBe(false);
  });

  it("is true when the bin exceeds the box capacity", () => {
    expect(isOutOfRange(31, 30)).toBe(true);
  });
});

describe("binOccupants", () => {
  const parts = [
    part(1, 100, "B9", 5),
    part(2, 101, "B9", 5),
    part(3, 102, "B9", 6),
    part(4, 103, "B8", 5),
  ];

  it("returns every part sharing the bin", () => {
    expect(binOccupants(parts, "B9", 5).map((p) => p.id)).toEqual([1, 2]);
  });

  it("does not match the same bin number in a different box", () => {
    expect(binOccupants(parts, "B8", 5).map((p) => p.id)).toEqual([4]);
  });

  it("returns an empty array for an empty bin", () => {
    expect(binOccupants(parts, "B9", 7)).toEqual([]);
  });
});

describe("nextFreeBin", () => {
  it("returns 1 for an empty box", () => {
    expect(nextFreeBin([], "B9")).toBe(1);
  });

  it("returns the lowest unoccupied bin, filling gaps", () => {
    const parts = [part(1, 100, "B9", 1), part(2, 101, "B9", 3)];
    expect(nextFreeBin(parts, "B9")).toBe(2);
  });

  it("ignores parts in other boxes", () => {
    const parts = [part(1, 100, "B8", 1), part(2, 101, "B8", 2)];
    expect(nextFreeBin(parts, "B9")).toBe(1);
  });

  it("ignores parts that have no bin yet", () => {
    const parts = [part(1, 100, "B9", 1), part(2, 101, "B9", null)];
    expect(nextFreeBin(parts, "B9")).toBe(2);
  });
});

describe("assignBins", () => {
  it("leaves parts that already have a bin untouched", () => {
    const parts = [part(1, 100, "B9", 7)];
    expect(assignBins(parts).size).toBe(0);
  });

  it("assigns unbinned parts the lowest free bins in item_code order", () => {
    const parts = [
      part(2, 200, "B9", null),
      part(1, 100, "B9", null),
      part(3, 300, "B9", null),
    ];
    const result = assignBins(parts);
    expect(result.get(1)).toBe(1);
    expect(result.get(2)).toBe(2);
    expect(result.get(3)).toBe(3);
  });

  it("skips bins already claimed explicitly", () => {
    const parts = [part(1, 100, "B9", null), part(2, 200, "B9", 1)];
    expect(assignBins(parts).get(1)).toBe(2);
  });

  it("treats a shared explicit bin as claimed once", () => {
    const parts = [
      part(1, 100, "B9", 1),
      part(2, 200, "B9", 1),
      part(3, 300, "B9", null),
    ];
    expect(assignBins(parts).get(3)).toBe(2);
  });

  it("assigns bins per box independently", () => {
    const parts = [part(1, 100, "B9", null), part(2, 200, "B8", null)];
    const result = assignBins(parts);
    expect(result.get(1)).toBe(1);
    expect(result.get(2)).toBe(1);
  });

  it("counts past the explicit bins rather than failing", () => {
    const parts = [
      part(1, 100, "B9", 1),
      part(2, 200, "B9", 2),
      part(3, 300, "B9", null),
      part(4, 400, "B9", null),
    ];
    const result = assignBins(parts);
    expect(result.get(3)).toBe(3);
    expect(result.get(4)).toBe(4);
  });

  it("ignores parts with no location", () => {
    const parts = [part(1, 100, null, null)];
    expect(assignBins(parts).size).toBe(0);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./bins"` (the module does not exist yet).

- [ ] **Step 5: Write the implementation**

Create `src/lib/bins.ts`.

```typescript
export type BinnedPart = {
  location: string | null;
  bin_number: number | null;
};

export type AssignablePart = BinnedPart & {
  id: number;
  item_code: number;
};

/** The printed physical address of a part, e.g. "B9-1". */
export function formatAddress(location: string, binNumber: number): string {
  return `${location}-${binNumber}`;
}

/** A bin past the box's physical compartment count. Legal, but flagged. */
export function isOutOfRange(binNumber: number, binCount: number): boolean {
  return binNumber > binCount;
}

/** Every part sharing a given bin. Bins are shareable by design. */
export function binOccupants<T extends BinnedPart>(
  parts: T[],
  location: string,
  binNumber: number
): T[] {
  return parts.filter(
    (p) => p.location === location && p.bin_number === binNumber
  );
}

/** The lowest bin number in a box that no part occupies. Fills gaps. */
export function nextFreeBin(parts: BinnedPart[], location: string): number {
  const taken = new Set(
    parts
      .filter((p) => p.location === location && p.bin_number != null)
      .map((p) => p.bin_number as number)
  );
  let bin = 1;
  while (taken.has(bin)) bin++;
  return bin;
}

/**
 * Backfill bin numbers. Parts with an explicit bin keep it. Parts without one
 * take the lowest free bin in their box, in item_code order. Assignment counts
 * past the box's bin_count rather than failing — an over-capacity bin is a
 * flagged state the user corrects, not an error.
 *
 * Returns a map of part id -> newly assigned bin number. Parts that already had
 * a bin, and parts with no location, are absent from the map.
 */
export function assignBins<T extends AssignablePart>(
  parts: T[]
): Map<number, number> {
  const assignments = new Map<number, number>();
  const byBox = new Map<string, T[]>();

  for (const part of parts) {
    if (!part.location) continue;
    const group = byBox.get(part.location);
    if (group) group.push(part);
    else byBox.set(part.location, [part]);
  }

  for (const group of byBox.values()) {
    const taken = new Set(
      group
        .filter((p) => p.bin_number != null)
        .map((p) => p.bin_number as number)
    );

    const unbinned = group
      .filter((p) => p.bin_number == null)
      .sort((a, b) => a.item_code - b.item_code);

    let bin = 1;
    for (const part of unbinned) {
      while (taken.has(bin)) bin++;
      assignments.set(part.id, bin);
      taken.add(bin);
      bin++;
    }
  }

  return assignments;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 16 tests green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bins.ts src/lib/bins.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: add bin arithmetic module with vitest"
```

---

### Task 2: Migration — backfill bins and enforce the model

The migration is a single SQL file that fixes data first and applies constraints second, so it cannot half-fail. The backfill reimplements `assignBins` in PL/pgSQL — same rules, verified against the same production numbers in Step 3.

**Files:**
- Create: `supabase/migrations/20260712000000_bin_addressed_storage.sql`

**Interfaces:**
- Consumes: nothing (SQL only).
- Produces: a schema where `parts.location` and `parts.bin_number` are `NOT NULL`, `parts.location` references `boxes(id)`, `parts.bin_number >= 1`, and `parts.barcode` no longer exists.

- [ ] **Step 1: Record the pre-migration state**

Run this to capture what the database looks like now, so Step 5 can prove the migration did what it claims.

```bash
set -a && . ./.env.local && set +a && \
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/parts?select=id,item_code,location,bin_number&order=id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" > /tmp/parts-before.json && \
node -e '
const p = require("/tmp/parts-before.json");
console.log("total:", p.length);
console.log("null location:", p.filter(x => !x.location).length);
console.log("null bin:", p.filter(x => x.bin_number == null).length);
console.log("explicit bins:", p.filter(x => x.bin_number != null).length);
console.log("REEL parts:", p.filter(x => x.location === "REEL").length);
'
```

Expected output:
```
total: 223
null location: 0
null bin: 174
explicit bins: 49
REEL parts: 3
```

If these numbers differ, the data has changed since the audit — stop and re-run the audit before migrating.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260712000000_bin_addressed_storage.sql`.

```sql
-- Bin-addressed storage.
-- Every part gets a required {box}-{bin} address. Bins stay shareable, and a
-- bin past a box's bin_count is allowed (flagged in the UI, corrected by hand)
-- because real data already contains such rows.

-- 1. REEL is a location with no boxes row. Its parts are stored loose on reels,
--    which the model treats as an ordinary box named REELS.
UPDATE parts SET location = 'REELS' WHERE location = 'REEL';

-- 2. Safety net: any remaining location without a boxes row gets one, sized to
--    hold its parts. Expected to insert nothing after step 1.
INSERT INTO boxes (id, bin_count, rows, cols)
SELECT p.location, GREATEST(COUNT(*), 1), 1, GREATEST(COUNT(*), 1)
FROM parts p
WHERE p.location IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM boxes b WHERE b.id = p.location)
GROUP BY p.location;

-- 3. Backfill bin_number. Parts with an explicit bin keep it. Parts without one
--    take the lowest bin in their box that nothing else claims, in item_code
--    order. row_number() over the unbinned parts, offset past every claimed bin
--    below it, produces exactly that sequence.
WITH claimed AS (
  SELECT location, bin_number
  FROM parts
  WHERE bin_number IS NOT NULL
  GROUP BY location, bin_number
),
unbinned AS (
  SELECT id, location, row_number() OVER (
    PARTITION BY location ORDER BY item_code
  ) AS seq
  FROM parts
  WHERE bin_number IS NULL
),
candidates AS (
  SELECT
    u.id,
    u.location,
    u.seq,
    -- Walk upward from seq, skipping claimed bins. Adding the count of claimed
    -- bins at-or-below the candidate and repeating until stable is what a
    -- while-loop would do; a generate_series of possible bins with a rank is
    -- the set-based equivalent.
    (
      SELECT b.bin
      FROM generate_series(
        1,
        u.seq + (SELECT COUNT(*) FROM claimed c WHERE c.location = u.location)
      ) AS b(bin)
      WHERE NOT EXISTS (
        SELECT 1 FROM claimed c
        WHERE c.location = u.location AND c.bin_number = b.bin
      )
      ORDER BY b.bin
      OFFSET u.seq - 1
      LIMIT 1
    ) AS assigned_bin
  FROM unbinned u
)
UPDATE parts p
SET bin_number = c.assigned_bin
FROM candidates c
WHERE p.id = c.id;

-- 4. Boxes must be able to name every bin their parts sit in. This raises
--    bin_count only where data already exceeds it; the user re-checks these
--    against the physical boxes afterward.
UPDATE boxes b
SET bin_count = GREATEST(b.bin_count, sub.max_bin)
FROM (
  SELECT location, MAX(bin_number) AS max_bin
  FROM parts
  WHERE location IS NOT NULL
  GROUP BY location
) sub
WHERE b.id = sub.location AND sub.max_bin > b.bin_count;

-- 5. Enforce the model.
ALTER TABLE parts ALTER COLUMN location SET NOT NULL;
ALTER TABLE parts ALTER COLUMN bin_number SET NOT NULL;
ALTER TABLE parts ADD CONSTRAINT parts_location_fkey
  FOREIGN KEY (location) REFERENCES boxes(id);
ALTER TABLE parts ADD CONSTRAINT parts_bin_number_positive
  CHECK (bin_number >= 1);

-- 6. Part-level barcodes are gone. Only box lids and bin compartments carry
--    printed identifiers now.
DROP INDEX IF EXISTS idx_parts_barcode_unique;
DROP INDEX IF EXISTS idx_parts_barcode;
ALTER TABLE parts DROP COLUMN barcode;
```

Note on step 4 of the SQL: `bin_count` is raised, never lowered. Boxes B7, B8, B9 and RED will end up with a `bin_count` above their true physical compartment count. That is intended — the user corrects them in the storage UI after seeing the flagged bins.

- [ ] **Step 3: Dry-run the assignment logic against production data before touching the database**

The SQL above must produce the same result as `assignBins` from Task 1. Verify that on the real rows, without writing anything:

```bash
set -a && . ./.env.local && set +a && \
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/parts?select=id,item_code,location,bin_number&order=id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" > /tmp/parts-dry.json && \
npx tsx -e '
import { assignBins } from "./src/lib/bins";
const parts = require("/tmp/parts-dry.json").map((p: any) => ({
  ...p,
  location: p.location === "REEL" ? "REELS" : p.location,
}));
const result = assignBins(parts);
console.log("parts needing a bin:", result.size);

// No two parts in a box may receive the same newly-assigned bin, and no new
// assignment may land on a bin someone already holds explicitly.
const byBox = new Map<string, Set<number>>();
for (const p of parts) {
  if (!p.location) continue;
  if (!byBox.has(p.location)) byBox.set(p.location, new Set());
  const bin = result.get(p.id) ?? p.bin_number;
  const seen = byBox.get(p.location)!;
  if (result.has(p.id) && seen.has(bin)) {
    throw new Error(`collision: ${p.location}-${bin} (part ${p.id})`);
  }
  if (result.has(p.id)) seen.add(bin);
}
console.log("no collisions");

// Final bin_count needed per box.
const maxByBox = new Map<string, number>();
for (const p of parts) {
  const bin = result.get(p.id) ?? p.bin_number;
  maxByBox.set(p.location, Math.max(maxByBox.get(p.location) ?? 0, bin));
}
console.log("max bin per box:", Object.fromEntries([...maxByBox].sort()));
'
```

Expected: `parts needing a bin: 174`, `no collisions`, and a max-bin-per-box map. Record that map — Step 5 compares against it.

If `npx tsx` is unavailable, install it: `npm install --save-dev tsx`.

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db push
```

Expected: `Applying migration 20260712000000_bin_addressed_storage.sql...` followed by `Finished supabase db push.`

- [ ] **Step 5: Verify the migrated data**

```bash
set -a && . ./.env.local && set +a && \
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/parts?select=id,item_code,location,bin_number&order=id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" > /tmp/parts-after.json && \
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/boxes?select=*&order=id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" > /tmp/boxes-after.json && \
node -e '
const before = require("/tmp/parts-before.json");
const after = require("/tmp/parts-after.json");
const boxes = require("/tmp/boxes-after.json");

console.log("total:", after.length, after.length === 223 ? "ok" : "MISMATCH");
console.log("missing bin:", after.filter(p => p.bin_number == null).length);
console.log("missing location:", after.filter(p => !p.location).length);
console.log("REEL left:", after.filter(p => p.location === "REEL").length);
console.log("has barcode field:", "barcode" in (after[0] || {}));

// Every part that had an explicit bin must still have that exact bin.
const beforeById = new Map(before.map(p => [p.id, p]));
const moved = after.filter(p => {
  const b = beforeById.get(p.id);
  return b && b.bin_number != null && b.bin_number !== p.bin_number;
});
console.log("explicitly-binned parts moved:", moved.length, moved);

// No box may hold a part in a bin it cannot name.
const cap = Object.fromEntries(boxes.map(b => [b.id, b.bin_count]));
const over = after.filter(p => p.bin_number > cap[p.location]);
console.log("parts above bin_count:", over.length);
'
```

Expected:
```
total: 223 ok
missing bin: 0
missing location: 0
REEL left: 0
has barcode field: false
explicitly-binned parts moved: 0 []
parts above bin_count: 0
```

`explicitly-binned parts moved: 0` is the important one — the migration must never relocate a part the user had already placed by hand.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260712000000_bin_addressed_storage.sql
git commit -m "feat: migrate to required bin addresses, drop part barcode"
```

---

### Task 3: Data layer — bin-aware queries, no barcode

Strip barcode from every query and add the two reads the new UI needs: the boxes list (for the box select) and the parts-in-box list (for bin occupancy hints).

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/actions.ts`

**Interfaces:**
- Consumes: `assignBins`, `nextFreeBin` from `src/lib/bins.ts` — not directly, but callers of these actions use them.
- Produces:
  - `Part` without `barcode`, with `location: string` and `bin_number: number` (both non-null).
  - `getPartsInBox(location: string): Promise<Pick<Part, "id" | "item_name" | "item_code" | "bin_number">[]>` — already exists; its return type tightens (`bin_number` is now `number`, not `number | null`).
  - `getBoxes(): Promise<Box[]>` — unchanged, but now the canonical source for the box select.
  - **Removed:** `getPartByBarcode()`, `sharebin()`.

- [ ] **Step 1: Update the Part type**

In `src/lib/types.ts`, replace the `Part` interface. `barcode` is gone; `location` and `bin_number` are no longer nullable.

```typescript
export interface Part {
  id: number;
  item_code: number;
  item_name: string;
  package: string | null;
  location: string;
  details: string | null;
  qty: number;
  bin_number: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
```

Leave `Box` and `QtyLog` untouched.

- [ ] **Step 2: Delete the barcode and share-bin actions**

In `src/lib/actions.ts`, delete `getPartByBarcode` (lines 46-54) entirely, and delete `sharebin` (lines 196-249) entirely. Nothing calls `sharebin` after Task 5; nothing calls `getPartByBarcode` after Task 7.

- [ ] **Step 3: Drop barcode from the search filter**

In `src/lib/actions.ts`, `getParts` currently searches `barcode`. That column no longer exists — leaving it in makes every search throw. Replace the `.or(...)` call:

```typescript
  if (search) {
    query = query.or(
      `item_name.ilike.%${search}%,details.ilike.%${search}%,package.ilike.%${search}%`
    );
  }
```

- [ ] **Step 4: Drop barcode from importParts**

In `src/lib/actions.ts`, `importParts` takes and inserts a `barcode`. Replace the whole function — the row shape loses `barcode` and gains a required `bin_number`:

```typescript
export async function importParts(
  parts: {
    item_code: number;
    item_name: string;
    package?: string;
    location: string;
    bin_number: number;
    details?: string;
    qty?: number;
  }[]
) {
  // Insert one at a time — bulk upsert on a partial conflict target is unreliable here.
  const results = [];
  for (const p of parts) {
    const row = {
      item_code: p.item_code,
      item_name: p.item_name,
      package: p.package || null,
      location: p.location,
      bin_number: p.bin_number,
      details: p.details || null,
      qty: p.qty || 0,
    };

    const { data, error } = await supabase
      .from("parts")
      .upsert(row, { onConflict: "item_code" })
      .select()
      .single();
    if (error) throw new Error(`Row ${p.item_code} (${p.item_name}): ${error.message}`);
    results.push(data);
  }
  return results;
}
```

- [ ] **Step 5: Tighten getPartsInBox**

In `src/lib/actions.ts`, `getPartsInBox` still types `bin_number` as nullable. Replace it:

```typescript
export async function getPartsInBox(
  location: string
): Promise<{ id: number; item_name: string; item_code: number; bin_number: number }[]> {
  const { data, error } = await supabase
    .from("parts")
    .select("id, item_name, item_code, bin_number")
    .eq("location", location)
    .order("bin_number");
  if (error) throw error;
  return data as { id: number; item_name: string; item_code: number; bin_number: number }[];
}
```

- [ ] **Step 6: Typecheck to find every remaining barcode reference**

Run: `npx tsc --noEmit`
Expected: FAIL, with errors in `src/app/scan/page.tsx`, `src/app/labels/page.tsx`, `src/app/parts/page.tsx`, `src/app/parts/new/page.tsx`, `src/app/import/page.tsx`, `src/components/part-form.tsx`, `src/components/part-card.tsx`, and `src/components/label-grid.tsx` — all "Property 'barcode' does not exist on type 'Part'".

That error list is the task list for Tasks 4-8. Do not fix them here.

- [ ] **Step 7: Commit**

The build is intentionally broken between this commit and Task 8. Say so in the message.

```bash
git add src/lib/types.ts src/lib/actions.ts
git commit -m "feat: drop barcode from data layer, require box and bin

Typecheck is red until the UI catches up in the following commits."
```

---

### Task 4: Storage grid reads real bin addresses

`box-grid.tsx` currently invents bin positions: parts with a null `bin_number` get packed into whatever slots are free, purely for display. Bins are real addresses now, so that logic is a lie and must go. In its place: render each part at its own bin, and surface parts whose bin exceeds the box's capacity in a warning strip below the grid.

**Files:**
- Modify: `src/components/box-grid.tsx`

**Interfaces:**
- Consumes: `binOccupants`, `isOutOfRange`, `formatAddress` from `src/lib/bins.ts`; `Box`, `Part` from `src/lib/types.ts`.
- Produces: `BoxGrid` keeps its existing props — `{ box: Box; parts: Part[]; onEdit: () => void }`. `src/app/storage/page.tsx` needs no change.

- [ ] **Step 1: Rewrite box-grid.tsx**

Replace the whole file.

```tsx
"use client";

import Link from "next/link";
import { isOutOfRange, formatAddress } from "@/lib/bins";
import type { Box, Part } from "@/lib/types";

export function BoxGrid({
  box,
  parts,
  onEdit,
}: {
  box: Box;
  parts: Part[];
  onEdit: () => void;
}) {
  const totalSlots = box.bin_count;

  // A part sits at its bin_number. Nothing is inferred.
  const bins: Part[][] = Array.from({ length: totalSlots }, () => []);
  const outOfRange: Part[] = [];

  for (const part of parts) {
    if (isOutOfRange(part.bin_number, totalSlots)) {
      outOfRange.push(part);
    } else {
      bins[part.bin_number - 1].push(part);
    }
  }

  const usedCount = bins.filter((b) => b.length > 0).length;
  const fillPct = totalSlots > 0 ? (usedCount / totalSlots) * 100 : 0;
  const fillColor =
    fillPct > 90
      ? "bg-red-500"
      : fillPct > 75
      ? "bg-amber-500"
      : "bg-green-500";

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-lg">{box.id}</h3>
          <span className="text-xs text-muted-foreground font-mono">
            {usedCount}/{totalSlots} bins
          </span>
          {outOfRange.length > 0 && (
            <span className="text-xs font-medium text-red-400">
              {outOfRange.length} out of range
            </span>
          )}
        </div>
        <button
          onClick={onEdit}
          className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1"
        >
          Edit
        </button>
      </div>

      {/* Fill bar */}
      <div className="h-1 bg-secondary">
        <div
          className={`h-full transition-all ${fillColor}`}
          style={{ width: `${Math.min(fillPct, 100)}%` }}
        />
      </div>

      {/* Bin grid */}
      <div
        className="p-3 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${box.cols}, minmax(0, 1fr))` }}
      >
        {bins.map((binParts, i) => {
          const binNum = i + 1;

          if (binParts.length === 0) {
            return (
              <div
                key={binNum}
                className="flex items-center justify-center rounded-lg border border-green-500/30 bg-green-500/10 min-h-[52px]"
              >
                <span className="text-[10px] font-mono text-green-500/50">
                  {binNum}
                </span>
              </div>
            );
          }

          if (binParts.length > 1) {
            return (
              <div
                key={binNum}
                className="relative flex flex-col items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 p-1 min-h-[52px] gap-0.5"
                title={`${formatAddress(box.id, binNum)}: ${binParts
                  .map((p) => p.item_name)
                  .join(", ")}`}
              >
                <span className="text-[10px] font-mono text-amber-500/60 leading-none">
                  {binNum}
                </span>
                {binParts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/parts?id=${p.id}`}
                    className="text-[9px] text-center leading-tight text-foreground/70 hover:text-amber-400 transition-colors truncate w-full"
                  >
                    {p.item_name.length > 10
                      ? p.item_name.slice(0, 9) + "…"
                      : p.item_name}
                  </Link>
                ))}
              </div>
            );
          }

          const only = binParts[0];
          return (
            <Link
              key={binNum}
              href={`/parts?id=${only.id}`}
              className="group relative flex flex-col items-center justify-center rounded-lg border border-primary/25 bg-primary/10 hover:bg-primary/20 transition-colors p-1.5 min-h-[52px]"
              title={`${formatAddress(box.id, binNum)} ${only.item_name}${
                only.qty === 0 ? " (empty)" : ""
              }`}
            >
              <span className="text-[10px] font-mono text-primary/60 leading-none">
                {binNum}
              </span>
              <span className="text-[10px] text-center leading-tight mt-0.5 text-foreground/80 line-clamp-2 break-all">
                {only.item_name.length > 12
                  ? only.item_name.slice(0, 11) + "…"
                  : only.item_name}
              </span>
              {only.qty === 0 && (
                <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Parts sitting in a bin this box does not physically have */}
      {outOfRange.length > 0 && (
        <div className="px-3 pb-3">
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-1.5">
            <p className="text-xs font-medium text-red-400">
              Out of range — this box has {totalSlots} bins
            </p>
            {outOfRange.map((p) => (
              <Link
                key={p.id}
                href={`/parts?id=${p.id}&edit=1`}
                className="flex items-center gap-2 text-xs text-foreground/80 hover:text-red-400 transition-colors"
              >
                <span className="font-mono text-red-400/80">
                  {formatAddress(box.id, p.bin_number)}
                </span>
                <span className="truncate">{p.item_name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck this file**

Run: `npx tsc --noEmit`
Expected: no errors in `src/components/box-grid.tsx`. Errors in the not-yet-updated files (`scan`, `labels`, `parts`, `parts/new`, `import`, `part-form`, `part-card`, `label-grid`) still appear — those are Tasks 5-8.

- [ ] **Step 3: Commit**

```bash
git add src/components/box-grid.tsx
git commit -m "feat: place parts at stored bin numbers, flag out-of-range bins"
```

---

### Task 5: Part form — required box and bin picker

The edit form's "share a bin with another part" checkbox and its `sharebin()` round-trip disappear. Sharing a bin is now just typing a bin number someone else already has, and the form says so as you type.

**Files:**
- Modify: `src/components/part-form.tsx`

**Interfaces:**
- Consumes: `getBoxes`, `getPartsInBox`, `getPackages`, `getNextItemCode`, `createPart`, `updatePart` from `src/lib/actions.ts`; `nextFreeBin`, `isOutOfRange` from `src/lib/bins.ts`; `Box`, `Part` from `src/lib/types.ts`.
- Produces: `PartForm` keeps its `{ part?: Part }` prop. Callers (`src/app/parts/page.tsx`) need no change.

- [ ] **Step 1: Replace the imports and state**

In `src/components/part-form.tsx`, replace everything from the import block through the end of the `handleSubmit` function (lines 1-138) with the following. The barcode display, the `sharedBin`/`shareTargetId` state, and the `sharebin` call are all gone; a required `location` + `bin_number` pair takes their place.

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  createPart,
  updatePart,
  getNextItemCode,
  getPackages,
  getPartsInBox,
  getBoxes,
} from "@/lib/actions";
import { nextFreeBin, isOutOfRange, formatAddress } from "@/lib/bins";
import type { Box, Part } from "@/lib/types";

const LAST_LOCATION_KEY = "inventory-last-location";

export function PartForm({ part }: { part?: Part }) {
  const router = useRouter();
  const isNew = !part;
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<string[]>([]);
  const [showPkgDropdown, setShowPkgDropdown] = useState(false);
  const pkgRef = useRef<HTMLDivElement>(null);

  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxParts, setBoxParts] = useState<
    { id: number; item_name: string; item_code: number; bin_number: number }[]
  >([]);

  const [formData, setFormData] = useState({
    item_code: part?.item_code ?? 0,
    item_name: part?.item_name ?? "",
    package: part?.package ?? "",
    location: part?.location ?? "",
    bin_number: part?.bin_number ?? 0,
    details: part?.details ?? "",
    qty: part?.qty ?? 0,
  });

  useEffect(() => {
    getPackages().then(setPackages);
    getBoxes().then(setBoxes);

    if (isNew) {
      getNextItemCode().then((code) =>
        setFormData((prev) => ({ ...prev, item_code: code }))
      );
      const lastLoc = localStorage.getItem(LAST_LOCATION_KEY);
      if (lastLoc) {
        setFormData((prev) => ({ ...prev, location: lastLoc }));
      }
    }
  }, [isNew]);

  // Load the box's occupants whenever the box changes, so the bin field can say
  // who is already in the bin you typed.
  useEffect(() => {
    if (!formData.location) {
      setBoxParts([]);
      return;
    }
    getPartsInBox(formData.location)
      .then((parts) => {
        setBoxParts(parts);
        // A new part in a freshly-chosen box defaults to the first free bin.
        setFormData((prev) => {
          if (!isNew || prev.bin_number !== 0) return prev;
          return {
            ...prev,
            bin_number: nextFreeBin(
              parts.map((p) => ({
                location: formData.location,
                bin_number: p.bin_number,
              })),
              formData.location
            ),
          };
        });
      })
      .catch(() => setBoxParts([]));
  }, [formData.location, isNew]);

  // Close package dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pkgRef.current && !pkgRef.current.contains(e.target as Node)) {
        setShowPkgDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedBox = boxes.find((b) => b.id === formData.location);
  const overCapacity =
    !!selectedBox &&
    formData.bin_number > 0 &&
    isOutOfRange(formData.bin_number, selectedBox.bin_count);

  const binMates = boxParts.filter(
    (p) => p.bin_number === formData.bin_number && p.id !== part?.id
  );

  const filteredPackages = formData.package
    ? packages.filter((p) =>
        p.toLowerCase().includes(formData.package.toLowerCase())
      )
    : packages;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!formData.location) {
      toast.error("Pick a box");
      return;
    }
    if (formData.bin_number < 1) {
      toast.error("Bin number must be 1 or higher");
      return;
    }

    setLoading(true);
    try {
      localStorage.setItem(LAST_LOCATION_KEY, formData.location);

      const payload = {
        item_code: formData.item_code,
        item_name: formData.item_name,
        package: formData.package || null,
        location: formData.location,
        bin_number: formData.bin_number,
        details: formData.details || null,
        qty: formData.qty,
      };

      if (part) {
        await updatePart(part.id, payload);
        toast.success(`Updated "${formData.item_name}"`);
        router.push(`/parts?id=${part.id}`);
      } else {
        const created = await createPart(payload);
        toast.success(`Created "${formData.item_name}"`);
        router.push(`/parts?id=${created.id}`);
      }
    } catch (e) {
      toast.error("Failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 2: Replace the barcode field with the address readout**

Still in `src/components/part-form.tsx`, the JSX opens with a two-column grid whose first cell shows the computed barcode. Replace that first cell (the `<div className="space-y-2">` containing the `Barcode` label and the read-only barcode box) with an address readout:

```tsx
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Address
          </Label>
          <div className="h-9 px-3 flex items-center rounded-lg bg-muted/50 border border-border/30 font-mono text-sm text-muted-foreground">
            {formData.location && formData.bin_number > 0
              ? formatAddress(formData.location, formData.bin_number)
              : "pick a box and bin"}
          </div>
        </div>
```

- [ ] **Step 3: Replace the location input and the share-bin block**

Still in `src/components/part-form.tsx`, replace the free-text Location input (the `<div className="space-y-2">` with `<Label htmlFor="location">`) with a box select, and delete the entire share-bin block (the `{formData.location && ( ... )}` section containing the "Share a bin with another part" checkbox). In their place:

```tsx
        <div className="space-y-2">
          <Label htmlFor="location" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Box
          </Label>
          <select
            id="location"
            value={formData.location}
            onChange={(e) =>
              setFormData({ ...formData, location: e.target.value, bin_number: 0 })
            }
            required
            className="w-full h-9 px-3 rounded-lg bg-secondary border border-border/50 font-mono text-sm focus:outline-none focus:border-primary"
          >
            <option value="">Select a box...</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id} ({b.bin_count} bins)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bin */}
      <div className="space-y-2">
        <Label htmlFor="bin_number" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Bin
        </Label>
        <Input
          id="bin_number"
          type="number"
          min={1}
          value={formData.bin_number || ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              bin_number: parseInt(e.target.value) || 0,
            })
          }
          disabled={!formData.location}
          required
          className="font-mono bg-secondary border-border/50"
        />
        {overCapacity && selectedBox && (
          <p className="text-xs text-red-400">
            Outside box capacity ({selectedBox.bin_count} bins). Saved anyway —
            fix the box size or move the part.
          </p>
        )}
        {binMates.length > 0 && (
          <p className="text-xs text-amber-400">
            Sharing this bin with: {binMates.map((p) => p.item_name).join(", ")}
          </p>
        )}
      </div>
```

Note the `</div>` before the Bin block — it closes the two-column grid that the Package and Box fields sit in. The Bin field is full-width below it.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/components/part-form.tsx`. Remaining errors are in Tasks 6-8's files.

- [ ] **Step 5: Commit**

```bash
git add src/components/part-form.tsx
git commit -m "feat: require box and bin on part form, drop share-bin flow"
```

---

### Task 6: Add-parts queue — box and bin per queued part

`src/app/parts/new/page.tsx` is the real add flow: paste an order table, get a queue of parts, edit them, insert. Every queued part now needs a bin. Bins are handed out from the chosen box's first free slot, counting up across the queue so two queued parts never collide.

**Files:**
- Modify: `src/app/parts/new/page.tsx`

**Interfaces:**
- Consumes: `getBoxes`, `getPartsInBox`, `createPart`, `getNextItemCode`, `getPackages` from `src/lib/actions.ts`; `nextFreeBin`, `isOutOfRange`, `formatAddress` from `src/lib/bins.ts`; `Box` from `src/lib/types.ts`.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Replace barcode with bin_number in the queue shape**

In `src/app/parts/new/page.tsx`, the `QueuedPart` interface (around line 25) carries a `barcode`. Replace it:

```typescript
interface QueuedPart {
  id: string;
  item_code: number;
  item_name: string;
  package: string;
  location: string;
  bin_number: number;
  details: string;
  qty: number;
  lowConfidence?: boolean;
}
```

- [ ] **Step 2: Drop barcode from the three parsers**

The file has three parser functions — `parseOrderTableFormat`, `parseInlineQtyFormat`, and `parseTabularFormat` — and each builds a row containing `const barcode = location ? \`${location}-${code}\` : "";` and then `barcode,` in the returned object. In all three, delete the `const barcode = ...` line and replace the `barcode,` field in the returned object with `bin_number: 0,`.

A bin of `0` means "not yet assigned" inside the queue only; Step 4 fills it before anything reaches the database, and Step 6 refuses to insert a queue that still holds a zero.

- [ ] **Step 3: Load boxes and track bin assignment state**

Near the other `useState` calls in the `AddPartsPage` component, add box state and the occupancy of the currently-selected box:

```typescript
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxOccupancy, setBoxOccupancy] = useState<
    { location: string; bin_number: number }[]
  >([]);
```

Import `Box` from `@/lib/types`, and `getBoxes`, `getPartsInBox` from `@/lib/actions`, and `nextFreeBin`, `isOutOfRange`, `formatAddress` from `@/lib/bins`.

In the existing mount `useEffect` (the one that calls `getNextItemCode` and `getPackages`), add:

```typescript
    getBoxes().then(setBoxes);
```

And add a new effect that refreshes occupancy whenever the form's box changes:

```typescript
  useEffect(() => {
    if (!form.location) {
      setBoxOccupancy([]);
      return;
    }
    getPartsInBox(form.location)
      .then((parts) =>
        setBoxOccupancy(
          parts.map((p) => ({
            location: form.location,
            bin_number: p.bin_number,
          }))
        )
      )
      .catch(() => setBoxOccupancy([]));
  }, [form.location]);
```

- [ ] **Step 4: Assign bins as parts enter the queue**

Add this helper inside the component. It hands each part the next bin that neither the database nor the rest of the queue already holds — so pasting ten parts into B9 fills ten consecutive free bins.

```typescript
  // The next bin free in the box, accounting for both stored parts and parts
  // already sitting in the queue.
  function allocateBins(
    location: string,
    count: number,
    queued: QueuedPart[]
  ): number[] {
    const occupied = [
      ...boxOccupancy.filter((p) => p.location === location),
      ...queued
        .filter((p) => p.location === location && p.bin_number > 0)
        .map((p) => ({ location: p.location, bin_number: p.bin_number })),
    ];
    const bins: number[] = [];
    for (let i = 0; i < count; i++) {
      const bin = nextFreeBin(occupied, location);
      bins.push(bin);
      occupied.push({ location, bin_number: bin });
    }
    return bins;
  }
```

Then, everywhere a part is pushed onto the queue, stamp its bin. The two places are the single-part add handler and the paste handler.

In the single-part add handler (the one that builds a part from `form` and appends it — it currently sets `barcode`), replace the `barcode` field with:

```typescript
      bin_number: allocateBins(form.location.trim(), 1, queue)[0],
```

In the paste handler (the one calling `parsePastedText`), after `const parsed = parsePastedText(pasteText, startCode, location);`, assign bins to the whole batch before it hits the queue:

```typescript
    const bins = allocateBins(location, parsed.length, queue);
    const withBins = parsed.map((p, i) => ({ ...p, bin_number: bins[i] }));
```

and append `withBins` instead of `parsed`.

- [ ] **Step 5: Update the edit dialog and queue row**

The queue row currently renders `{part.barcode || \`#${part.item_code}\`}` and, separately, `{part.location}`. Replace that pair with the address:

```tsx
                    {formatAddress(part.location, part.bin_number)}
                    <span className="text-muted-foreground/60 ml-2 font-sans">
                      #{part.item_code}
                    </span>
```

The edit dialog shows a computed `{editingPart.location}-{editingPart.item_code}` readout and a free-text location input. Replace the readout with `{formatAddress(editingPart.location, editingPart.bin_number)}`, replace the location input with a `<select>` over `boxes` (same markup as Task 5, Step 3, bound to `editingPart.location`), and add a bin number `<Input>` bound to `editingPart.bin_number` beneath it:

```tsx
                  <Input
                    type="number"
                    min={1}
                    value={editingPart.bin_number || ""}
                    onChange={(e) =>
                      setEditingPart({
                        ...editingPart,
                        bin_number: parseInt(e.target.value) || 0,
                      })
                    }
                    className="font-mono bg-secondary border-border/50"
                  />
```

Also delete the "Recalculate barcode from location + item_code" block in the dialog's save handler — there is no barcode to recalculate.

The form's own Location input (around line 619) becomes a box select too — same `<select>` over `boxes`, bound to `form.location`.

- [ ] **Step 6: Guard and fix the insert**

The insert loop currently passes `barcode` and `bin_number: null`. Replace the row it builds with:

```typescript
        await createPart({
          item_code: p.item_code,
          item_name: p.item_name,
          package: p.package || null,
          location: p.location,
          bin_number: p.bin_number,
          details: p.details || null,
          qty: p.qty,
        });
```

Before the loop runs, refuse a queue that is missing an address:

```typescript
    const unaddressed = queue.filter((p) => !p.location || p.bin_number < 1);
    if (unaddressed.length > 0) {
      toast.error(
        `${unaddressed.length} part(s) have no box or bin. Fix them before saving.`
      );
      return;
    }
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/app/parts/new/page.tsx`. Remaining errors are Tasks 7-8's files.

- [ ] **Step 8: Commit**

```bash
git add src/app/parts/new/page.tsx
git commit -m "feat: assign box and bin to every queued part on add"
```

---

### Task 7: Delete scanning, print bin stickers

Part labels and QR scanning are gone. `/labels` keeps box labels and gains a bin-number sticker sheet: for a chosen box, the numbers `1..bin_count` laid out in that box's `rows × cols` grid, sized to sit on compartment floors.

**Files:**
- Delete: `src/app/scan/page.tsx`
- Delete: `src/components/qr-scanner.tsx`
- Delete: `src/components/label-grid.tsx`
- Create: `src/components/bin-label-grid.tsx`
- Modify: `src/app/labels/page.tsx`
- Modify: `package.json` (drop `html5-qrcode`)

**Interfaces:**
- Consumes: `Box` from `src/lib/types.ts`; `getBoxes` from `src/lib/actions.ts`.
- Produces: `BinLabelGrid({ box }: { box: Box })` — a print-only sheet of numbered stickers for one box.

- [ ] **Step 1: Delete the scanner and part labels**

```bash
rm -rf src/app/scan
rm src/components/qr-scanner.tsx
rm src/components/label-grid.tsx
npm uninstall html5-qrcode
```

`/scan` is not in the nav (`src/app/layout.tsx` links only `/`, `/storage`, `/parts/new`, `/labels`), so nothing links to it.

- [ ] **Step 2: Create the bin sticker sheet**

Create `src/components/bin-label-grid.tsx`. Stickers are plain numbers — big, centered, cut-lined — because a bin's identity is only meaningful next to its box's printed ID.

```tsx
"use client";

import type { Box } from "@/lib/types";

// Bin stickers: one per compartment, laid out in the box's own rows × cols
// so the printed sheet matches the physical box face.

export function BinLabelGrid({ box }: { box: Box }) {
  const bins = Array.from({ length: box.bin_count }, (_, i) => i + 1);

  return (
    <div className="hidden print:block">
      <div className="text-center mb-4">
        <span className="text-2xl font-bold">{box.id}</span>
        <span className="text-sm ml-2 text-black/60">
          {box.bin_count} bins ({box.rows}×{box.cols})
        </span>
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${box.cols}, minmax(0, 1fr))` }}
      >
        {bins.map((bin) => (
          <div
            key={bin}
            className="flex items-center justify-center border border-dashed border-black/40 aspect-square"
          >
            <span className="text-3xl font-bold font-mono text-black">
              {bin}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the labels page**

Replace `src/app/labels/page.tsx` entirely. The part-label mode, the part table, and the location filter all go; a bin-sticker mode with a box picker takes their place.

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BoxLabelGrid } from "@/components/box-label-grid";
import { BinLabelGrid } from "@/components/bin-label-grid";
import { getBoxes } from "@/lib/actions";
import type { Box } from "@/lib/types";

export default function LabelsPage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [labelType, setLabelType] = useState<"boxes" | "bins">("boxes");
  const [selectedBoxes, setSelectedBoxes] = useState<Set<string>>(new Set());
  const [binBoxId, setBinBoxId] = useState<string | null>(null);

  useEffect(() => {
    getBoxes().then(setBoxes);
  }, []);

  const selectedBoxList = boxes.filter((b) => selectedBoxes.has(b.id));
  const binBox = boxes.find((b) => b.id === binBoxId) ?? null;

  function toggleAllBoxes(checked: boolean) {
    setSelectedBoxes(checked ? new Set(boxes.map((b) => b.id)) : new Set());
  }

  function toggleBox(id: string) {
    const next = new Set(selectedBoxes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBoxes(next);
  }

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="print:hidden space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Labels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Print box lids and bin compartment numbers
          </p>
        </div>

        <div className="flex gap-2">
          <FilterChip
            active={labelType === "boxes"}
            onClick={() => setLabelType("boxes")}
          >
            Box Labels
          </FilterChip>
          <FilterChip
            active={labelType === "bins"}
            onClick={() => setLabelType("bins")}
          >
            Bin Numbers
          </FilterChip>
        </div>

        {labelType === "boxes" && (
          <>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={
                    boxes.length > 0 &&
                    boxes.every((b) => selectedBoxes.has(b.id))
                  }
                  onChange={(e) => toggleAllBoxes(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                <span className="text-muted-foreground">
                  Select all ({boxes.length})
                </span>
              </label>
              {selectedBoxes.size > 0 && (
                <span className="text-xs text-primary font-medium">
                  {selectedBoxes.size} selected (2 copies each)
                </span>
              )}
            </div>

            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <tbody>
                    {boxes.map((box) => (
                      <tr
                        key={box.id}
                        className="border-t border-border/30 hover:bg-accent/50 cursor-pointer"
                        onClick={() => toggleBox(box.id)}
                      >
                        <td className="p-3 w-8">
                          <input
                            type="checkbox"
                            checked={selectedBoxes.has(box.id)}
                            onChange={() => toggleBox(box.id)}
                            className="accent-primary"
                          />
                        </td>
                        <td className="p-3 font-semibold">{box.id}</td>
                        <td className="p-3 text-muted-foreground text-xs">
                          {box.bin_count} bins ({box.rows}×{box.cols})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button
              onClick={() => window.print()}
              disabled={selectedBoxes.size === 0}
              size="lg"
            >
              Print {selectedBoxes.size} box labels ({selectedBoxes.size * 2}{" "}
              copies)
            </Button>
          </>
        )}

        {labelType === "bins" && (
          <>
            <div className="flex gap-2 flex-wrap">
              {boxes.map((box) => (
                <FilterChip
                  key={box.id}
                  active={binBoxId === box.id}
                  onClick={() => setBinBoxId(box.id)}
                >
                  {box.id}
                </FilterChip>
              ))}
            </div>

            {binBox && (
              <p className="text-sm text-muted-foreground">
                {binBox.bin_count} bin stickers, laid out {binBox.rows}×
                {binBox.cols} to match the box.
              </p>
            )}

            <Button
              onClick={() => window.print()}
              disabled={!binBox}
              size="lg"
            >
              {binBox
                ? `Print ${binBox.bin_count} bin numbers for ${binBox.id}`
                : "Pick a box"}
            </Button>
          </>
        )}
      </div>

      {labelType === "boxes" && selectedBoxList.length > 0 && (
        <BoxLabelGrid boxes={selectedBoxList} />
      )}
      {labelType === "bins" && binBox && <BinLabelGrid box={binBox} />}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
          : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/app/labels/page.tsx` or `src/components/bin-label-grid.tsx`. The last remaining errors are in `src/components/part-card.tsx`, `src/app/parts/page.tsx`, and `src/app/import/page.tsx` — Task 8.

- [ ] **Step 5: Commit**

```bash
git add -A src/app/scan src/components/qr-scanner.tsx src/components/label-grid.tsx src/components/bin-label-grid.tsx src/app/labels/page.tsx package.json package-lock.json
git commit -m "feat: print bin number stickers, remove QR scanning and part labels"
```

---

### Task 8: Show addresses, finish the barcode removal

The last three files still reference `part.barcode`. Replacing each with the `B9-1` address closes the loop and makes the typecheck green for the first time since Task 3.

**Files:**
- Modify: `src/components/part-card.tsx`
- Modify: `src/app/parts/page.tsx`
- Modify: `src/app/import/page.tsx`

**Interfaces:**
- Consumes: `formatAddress`, `binOccupants` from `src/lib/bins.ts`; `getBoxes` from `src/lib/actions.ts`.
- Produces: nothing consumed elsewhere. After this task, `grep -rn "barcode" src/` returns nothing.

- [ ] **Step 1: Address badge on the part card**

In `src/components/part-card.tsx`, import the helpers:

```tsx
import { formatAddress, binOccupants } from "@/lib/bins";
```

Replace the barcode/location line (the `<div className="text-xs text-muted-foreground truncate font-mono">` block, lines 61-73) with:

```tsx
          <div className="text-xs text-muted-foreground truncate font-mono">
            <span className="text-primary/80">
              {formatAddress(part.location, part.bin_number)}
            </span>
            {part.details && (
              <span className="font-sans ml-2 text-muted-foreground/70">
                {part.details}
              </span>
            )}
          </div>
```

Replace the "Shared with" block (lines 74-84) — it hand-rolled the sibling filter, which `binOccupants` now owns:

```tsx
          {allParts && (() => {
            const siblings = binOccupants(
              allParts,
              part.location,
              part.bin_number
            ).filter((p) => p.id !== part.id);
            if (siblings.length === 0) return null;
            return (
              <div className="text-xs text-muted-foreground/60 truncate">
                Shared with: {siblings.map((p) => p.item_name).join(", ")}
              </div>
            );
          })()}
```

In the delete-confirmation dialog, replace `{part.barcode && <> ({part.barcode})</>}` with:

```tsx
            {" "}({formatAddress(part.location, part.bin_number)})
```

- [ ] **Step 2: Address on the part detail page**

In `src/app/parts/page.tsx`, import `formatAddress` from `@/lib/bins`.

Replace the barcode line (around line 119):

```tsx
            <p className="text-sm text-muted-foreground font-mono mt-1">
              {formatAddress(part.location, part.bin_number)}
            </p>
```

The standalone location badge (around line 139) is now redundant — the address already names the box. Delete that `{part.location && (...)}` block.

In the delete dialog (around line 252), replace `{part.barcode && <> ({part.barcode})</>}` with:

```tsx
              {" "}({formatAddress(part.location, part.bin_number)})
```

- [ ] **Step 3: Box and bin on import**

`src/app/import/page.tsx` parses an xlsx into `PreviewRow`s. Drop the barcode column and require an address.

Replace the `PreviewRow` interface:

```typescript
interface PreviewRow {
  item_code: number;
  item_name: string;
  package?: string;
  location: string;
  bin_number: number;
  details?: string;
  qty?: number;
}
```

In `handleFile`, delete the two `barcode` lines (the `row["Barcode"] ?? row["barcode"]` lookup and the `barcode: barcode ? String(barcode) : undefined` field). Add a bin lookup beside the location lookup:

```typescript
          const bin =
            row["Bin"] ?? row["bin"] ?? row["Bin Number"] ?? row["bin_number"];
```

and in the returned object, replace the `location` field and add `bin_number`:

```typescript
            location: location ? String(location) : "",
            bin_number: bin ? parseInt(String(bin)) || 0 : 0,
```

Tighten the filter so a row without an address never reaches the database:

```typescript
        .filter((r) => r.item_code > 0 && r.item_name && r.location && r.bin_number > 0);
```

Update the header copy:

```tsx
        <p className="text-sm text-muted-foreground mt-1">
          Upload an .xlsx file with columns: Item Code, Item Name, Package, Location, Bin, Details, Qty Available
        </p>
```

In the preview table, the first `<th>` reads `Barcode`. Change it to `Bin`, and change the matching `<td>` in the body from `{row.barcode}` to `{formatAddress(row.location, row.bin_number)}` — importing `formatAddress` from `@/lib/bins`.

- [ ] **Step 4: Verify no barcode reference survives**

Run: `grep -rn "barcode" src/`
Expected: no output.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean. This is the first green typecheck since Task 3.

- [ ] **Step 6: Run the unit tests**

Run: `npm test`
Expected: PASS — the 16 bin tests from Task 1 still green.

- [ ] **Step 7: Commit**

```bash
git add src/components/part-card.tsx src/app/parts/page.tsx src/app/import/page.tsx
git commit -m "feat: show B9-1 addresses in place of part barcodes"
```

---

### Task 9: Drive the app and confirm the whole flow

Typecheck proves the code compiles. It does not prove a bin sticker prints, or that saving an over-capacity bin actually warns rather than throws. Drive it.

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the storage grid against the migrated data**

Open `http://localhost:3000/storage`.

Confirm:
- Every box renders its grid, and parts sit at their own bin numbers (bin 5 of B9 holds whatever the database says is at B9-5).
- Bins with two or more parts show the amber shared treatment.
- No box shows an "out of range" strip — Task 2, Step 5 raised every `bin_count` above its highest bin, so nothing should be flagged yet.
- The `REELS` box exists and holds 9 parts. There is no `REEL` box.

- [ ] **Step 3: Force an out-of-range part and confirm it is flagged**

Edit box `B1` (2 parts, bin_count 10) and set its rows to 1 and cols to 1, so `bin_count` becomes 1. Save.

Confirm: `B1`'s grid now shows one bin, the header says "1 out of range", and the red strip below lists the part sitting at `B1-2` with a link to edit it.

Then set `B1` back to 2×5 (bin_count 10) and confirm the strip disappears.

- [ ] **Step 4: Create a part and confirm the bin defaults and warns**

Go to `/parts/new`. Pick box `B1` in the box select.

Confirm:
- The bin field pre-fills with the first free bin in B1 (3, since B1 holds parts at bins 1 and 2).
- Typing a bin already in use (1) shows the amber "Sharing this bin with: …" line naming the occupant.
- Typing a bin above the box's capacity (99) shows the red "Outside box capacity (10)" line — and the Save button stays enabled.
- Saving with bin 99 succeeds, and the part then appears in `B1`'s out-of-range strip on `/storage`.
- Delete that test part afterward.

- [ ] **Step 5: Paste a batch and confirm bins are allocated without collision**

On `/parts/new`, pick box `SANDBOX` (2 parts, 25 bins) and paste three rows of an order table.

Confirm: the three queued parts get three distinct bins, none colliding with SANDBOX's existing two parts, and each queue row shows its `SANDBOX-N` address. Save, then check `/storage` — the three land at those exact bins. Delete them afterward.

- [ ] **Step 6: Print a bin sticker sheet**

Go to `/labels`, choose "Bin Numbers", pick box `B9`, and click Print. In the print preview, confirm the sheet shows the numbers 1 through B9's bin_count, laid out to match its rows × cols, with `B9` named at the top.

Then choose "Box Labels", select two boxes, and confirm the print preview shows two copies of each box's QR label.

- [ ] **Step 7: Confirm search still works**

Go to `/`, search for a part by name. Confirm results appear (the search no longer touches the dropped `barcode` column) and each result card shows its `B9-1`-style address.

- [ ] **Step 8: Commit nothing, report findings**

This task produces no code. Report which steps passed. Any failure is a bug in an earlier task — fix it there, with a test if the failure is in bin arithmetic.

---

## Notes for whoever executes this

**The dropped barcode breaks the build on purpose.** Task 3 removes `barcode` from the `Part` type, and the typecheck stays red until Task 8 finishes updating the last consumer. That is the intended shape: the compiler enumerates the remaining work. Do not try to keep `main` green between Tasks 3 and 8 by leaving a vestigial `barcode` field — that defeats the point.

**The migration is not reversible.** `ALTER TABLE parts DROP COLUMN barcode` destroys data. The barcode was `location-item_code`, both of which survive, so nothing irreplaceable is lost — but there is no down migration. Run Task 2's Step 1 and Step 3 before Step 4, and stop if the numbers disagree with the audit.

**`bin_count` will be wrong after the migration, on purpose.** Boxes B7, B8, B9 and RED get their `bin_count` raised to fit bins that data already claims. Those numbers exceed the real compartment counts. The user will correct them by hand against the physical boxes — either by lowering `bin_count` (which surfaces the overflow parts in the out-of-range strip) or by re-binning the parts. Do not "fix" this in code.
