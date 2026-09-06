# Electronics Parts Inventory PWA — Build Prompt

Build a **Next.js 16** PWA for managing an electronics parts inventory with **Supabase** backend, deployed to **GitHub Pages** as a static export. Dark theme, mobile-first, single-user app.

---

## Tech Stack

- **Next.js 16** with App Router, TypeScript, `output: "export"` for static hosting
- **React 19** with client components (`"use client"` on all pages)
- **Supabase** (client-side only — no server actions, no SSR). Use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars.
- **Tailwind CSS v4** with `@tailwindcss/postcss`, dark mode via `oklch` color tokens
- **shadcn/ui** components (dialog, button, input, badge, card, separator, select, label, textarea)
- **Sonner** for toast notifications (dark theme, rich colors)
- **Lucide React** for icons
- **next-pwa** for PWA support (service worker, manifest, installable)
- **html5-qrcode** for camera-based QR scanning
- **qrcode** library for generating QR code images
- **xlsx** for spreadsheet import (.xlsx, .xls, .csv)
- **Geist** font family (sans + mono)
- **GitHub Actions** for CI/CD to GitHub Pages

---

## Database Schema (Supabase / PostgreSQL)

```sql
CREATE TABLE parts (
  id SERIAL PRIMARY KEY,
  barcode TEXT,
  item_code INTEGER UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  package TEXT,
  location TEXT,
  details TEXT,
  qty INTEGER DEFAULT 0,
  bin_number INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE qty_log (
  id SERIAL PRIMARY KEY,
  part_id INTEGER REFERENCES parts(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE boxes (
  id TEXT PRIMARY KEY,
  bin_count INTEGER NOT NULL DEFAULT 20,
  rows INTEGER NOT NULL DEFAULT 3,
  cols INTEGER NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX idx_parts_barcode_nonnull ON parts(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_parts_location ON parts(location);
CREATE INDEX idx_qty_log_part ON qty_log(part_id);

-- RLS: allow all (single-user, anon key)
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE qty_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE boxes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on parts" ON parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on qty_log" ON qty_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on boxes" ON boxes FOR ALL USING (true) WITH CHECK (true);
```

### TypeScript Types

```typescript
interface Part {
  id: number;
  barcode: string | null;
  item_code: number;
  item_name: string;
  package: string | null;
  location: string | null;
  details: string | null;
  qty: number;
  bin_number: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Box {
  id: string;
  bin_count: number;
  rows: number;
  cols: number;
  created_at: string;
}

interface QtyLog {
  id: number;
  part_id: number;
  delta: number;
  qty_after: number;
  note: string | null;
  created_at: string;
}
```

---

## Data Layer (src/lib/actions.ts)

All functions are regular async functions (NOT server actions) that import a shared Supabase client. No `"use server"` directive.

### Parts CRUD
- `getParts(search?, location?)` — search across item_name, details, package, barcode with ilike. Filter by location. Order by item_code ascending.
- `getPartById(id)` — single part by ID
- `getPartByBarcode(barcode)` — lookup by barcode, return null if not found
- `createPart(part)` — insert, return created part
- `updatePart(id, updates)` — partial update with updated_at timestamp
- `deletePart(id)` — delete by ID

### Quantity Management
- `adjustQty(partId, delta, note?)` — read current qty, compute new qty, update part, insert qty_log entry. Returns new qty.
- `getQtyLog(partId)` — all log entries ordered by created_at desc

### Autocomplete Helpers
- `getLocations()` — unique non-null location values
- `getPackages()` — unique non-null package values
- `getNextItemCode()` — max item_code + 1

### Import
- `importParts(parts[])` — upsert one-by-one with `onConflict: "item_code"`. Throws per-row errors.

### Boxes
- `getBoxes()` — all boxes ordered by id
- `getBoxesWithParts()` — fetches boxes and all parts with location in parallel, groups parts by location client-side. Returns `{ boxes, partsByBox }`.
- `createBox(id, bin_count, rows, cols)`
- `updateBox(id, { bin_count?, rows?, cols? })`
- `deleteBox(id)`

### Shared Bins
- `getPartsInBox(location)` — returns id, item_name, item_code, bin_number for parts in a location
- `sharebin(partId, targetPartId)` — computes the target's bin position (using existing bin_number or sequential position), then sets the same bin_number on both parts

---

## Pages

### `/` — Dashboard (Home)
- Title "Inventory" with part count
- Search input with clear (X) button, debounced 300ms fetch
- Location filter chips (All + each unique location)
- Sort dropdown: by ID (item_code) or by Name (alphabetical)
- Parts list using PartCard component
- URL sync: search and location filter persisted in query params via `window.history.replaceState` (NOT router.replace — avoids render loops in static export)
- Wrapped in `<Suspense>` for useSearchParams

### `/parts?id=X` — Part Detail
- Reads `id` from search params (no dynamic route — static export compatible)
- Shows: item_name, barcode, location badge, package badge, item_code badge, details
- **QtyAdjuster** component: -5, -1, current qty (large), +1, +5 buttons with optional note field
- **Notes** section: textarea with auto-save (800ms debounce after typing), "Saving..." indicator
- **History** section: qty_log entries with delta (green +, red -), qty_after, note, date
- Edit button opens PartForm in edit mode
- Delete button with confirmation dialog
- Wrapped in `<Suspense>`

### `/parts/new` — Add Parts (Queue System)
- Form with fields: barcode (auto-generated, read-only), item_code (editable number), item_name, package (with autocomplete dropdown), location (remembers last via localStorage), details, qty
- Barcode auto-computed: `{location}-{item_code}`
- **Queue system**: "Add to queue" button adds to local queue, "Save N parts" button batch-creates all
- Progress dialog during save with progress bar
- **Paste from order** dialog: parses pasted text from order confirmations
  - Detects "Product × Qty" inline format
  - Detects tabular format (tab or multi-space delimited)
  - Auto-detects headers (Product Name, Quantity, Package, Details)
  - Extracts package from name using regex (SOIC, DIP, QFP, TO-*, 0805, etc.)
  - Skips coupon/discount/total lines
- Queue items are editable (click to open edit dialog) and removable

### `/storage` — Storage Organizer
- Lists all boxes with BoxGrid visualization
- "Add Box" button opens dialog with: Box ID, Rows, Cols (bins auto-calculated as rows × cols)
- Edit box: change rows/cols, delete button
- Delete box confirmation dialog

### `/labels` — QR Label Printing
- Location filter chips
- Checkbox table to select parts
- "Select all" checkbox
- "Print N labels" button triggers `window.print()`
- LabelGrid component renders print-optimized QR labels (40mm × 12mm each, dashed cut lines)

### `/scan` — QR Scanner (disabled in nav but page exists)
- Camera-based QR scanning using html5-qrcode
- On scan: lookup part by barcode, navigate to detail if found
- Uses static ref div with `width: 100%` and `minHeight: 300` (required for html5-qrcode to measure container)

### `/import` — Spreadsheet Import (disabled in nav but page exists)
- File upload (.xlsx, .xls, .csv)
- Parses columns: Barcode, Item Code, Item Name, Package, Location, Details, Qty Available
- Preview table
- Import button with upsert

---

## Key Components

### PartCard
- Displays part in list: item_name, package badge, barcode, location, details snippet
- Qty with color coding: red (0), amber (≤3), primary (>3)
- Hover reveals edit (pencil) and delete (trash) icons
- Delete has confirmation dialog with toast notification

### PartForm
- Used for both create and edit
- Fields: barcode (display), item_code (editable), item_name, package (autocomplete), location, details, qty
- **Shared bin section** (shown when location is set): checkbox "Share a bin with another part" → dropdown of other parts in same box showing "Part Name (#item_code)"
- Package autocomplete: fetches existing packages, filters as you type, closes on outside click
- Location remembered in localStorage
- Success/failure toast notifications

### QtyAdjuster
- -5, -1, [current qty], +1, +5 buttons
- -5 and -1 disabled when qty is 0
- Optional note input field
- Loading state during adjustment

### BoxGrid
- Visual grid of bins for a box, columns set by `box.cols`
- Three bin states:
  - **Occupied (single)**: blue/primary border, shows bin number + truncated part name, links to part detail. Red dot if qty=0.
  - **Shared (multiple parts)**: amber border, shows bin number + each part name as clickable link
  - **Empty**: green border with bin number
- Fill bar at top: green (<75%), amber (75-90%), red (>90%)
- Header: box name, "N/M bins" count, Edit button
- Logic: shared bins (parts with bin_number) placed at their position, auto parts fill remaining slots sequentially

### LabelGrid
- Print-only component (hidden on screen via `print:` classes)
- Generates QR code data URLs using `qrcode` library
- Grid of labels: QR code image + item_name + barcode + package + location
- Dashed lines between labels for cutting
- 40mm × 12mm label size, A4 page format

### LocationFilter (BoxFilter)
- Row of filter chips: "All" + each location
- Active chip: primary bg. Inactive: secondary bg with hover

---

## Layout & Navigation

Sticky header with:
- Logo: Package icon + "Inventory" (links to `/`)
- Nav links with Lucide icons: Grid3X3 "Boxes" → `/storage`, Plus "Add" → `/parts/new`, Tags "Labels" → `/labels`
- Labels hidden on mobile (icon-only), visible on sm+

Dark theme hardcoded (`<html className="dark">`). Max content width: `max-w-2xl`.

---

## Deployment

### next.config.ts
```typescript
output: "export"
basePath: isProd ? "/inventory" : ""
assetPrefix: isProd ? "/inventory/" : ""
images: { unoptimized: true }
```

### GitHub Actions
- Trigger: push to master
- Build with npm ci + npm run build
- Supabase env vars from GitHub secrets
- Deploy to GitHub Pages using actions/deploy-pages@v4

### PWA
- manifest.json with relative paths (start_url: ".", icon srcs: "icon-192.png")
- Service worker via next-pwa (disabled in dev)
- .nojekyll file in public/ for GitHub Pages compatibility

### Favicon
- SVG: IC chip with pins on all 4 sides (4 pins per side), pin-1 dot, dark bg (#09090b) with amber pins (#e8a54b)
- PNG icons generated at 192px and 512px

---

## Design Patterns

1. **No server actions** — all Supabase calls are client-side using the public anon key
2. **No dynamic routes** — use query params (`/parts?id=X`) for static export compatibility
3. **No router.replace in useEffect** — use `window.history.replaceState` to avoid render loops
4. **No router.refresh()** — doesn't work with static export
5. **All pages are `"use client"`** with Suspense wrappers where useSearchParams is used
6. **Toast notifications** for all user actions (create, update, delete, import)
7. **Confirmation dialogs** for destructive actions (delete part, delete box)
8. **Loading skeletons** with animate-pulse on all pages
9. **Debounced search** (300ms) and debounced auto-save (800ms for notes)
10. **localStorage** for remembering last-used location
