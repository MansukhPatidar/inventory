"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  createPart,
  getNextItemCode,
  getPackages,
} from "@/lib/actions";

const LAST_LOCATION_KEY = "inventory-last-location";

interface QueuedPart {
  id: string;
  item_code: number;
  item_name: string;
  package: string;
  location: string;
  details: string;
  qty: number;
  barcode: string;
}

// --- Paste parser ---

const PKG_RE =
  /\b(SOI?C-?\d+|DIP-?\d+|QFP-?\d+|TQFP-?\d+|LQFP-?\d+|TO-?\d+|SOP-?\d+|SSOP-?\d+|TSSOP-?\d+|QFN-?\d+|BGA-?\d+|0[0-9]{3,4}|SMD|THT|through.?hole)\b/i;

interface ColumnMap {
  name: number;
  qty: number;
  pkg: number;
  details: number;
}

function detectHeader(headerCols: string[]): ColumnMap | null {
  const map: ColumnMap = { name: -1, qty: -1, pkg: -1, details: -1 };

  for (let i = 0; i < headerCols.length; i++) {
    const h = headerCols[i].toLowerCase().trim();
    if (
      (h.includes("product") && h.includes("name")) ||
      h === "name" ||
      h === "item name" ||
      h === "item" ||
      h === "product" ||
      h === "part" ||
      h === "component" ||
      h === "description"
    ) {
      if (map.name === -1) map.name = i;
    } else if (
      h === "quantity" ||
      h === "qty" ||
      h === "qty available" ||
      h === "count" ||
      h === "qty." ||
      h === "qty ordered"
    ) {
      map.qty = i;
    } else if (h === "package" || h === "pkg" || h === "footprint") {
      map.pkg = i;
    } else if (
      h === "details" ||
      h === "detail" ||
      h === "notes" ||
      h === "note" ||
      h === "desc"
    ) {
      map.details = i;
    }
    // Skip: product image, model, price, total, etc.
  }

  // Must have at least a name column
  return map.name !== -1 ? map : null;
}

// Pattern: "Product Name × 5" or "Product Name x 10" or "Product Name x10"
const INLINE_QTY_RE = /^(.+?)\s*[×xX✕]\s*(\d+)\s*$/;

// Lines to skip: coupons, discounts, empty-ish
const SKIP_LINE_RE = /^(QIKIFY|COUPON|DISCOUNT|PROMO|SUBTOTAL|TOTAL|SHIPPING|TAX|\s*[-–—]\s*Rs\.?)/i;

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

function parseInlineQtyFormat(
  lines: string[],
  startCode: number,
  location: string
): QueuedPart[] {
  const parts: QueuedPart[] = [];
  let code = startCode;

  for (const line of lines) {
    if (SKIP_LINE_RE.test(line)) continue;

    const match = line.match(INLINE_QTY_RE);
    if (!match) continue;

    const name = match[1].trim();
    const qty = parseInt(match[2]) || 0;
    if (!name) continue;

    let pkg = "";
    const pkgMatch = name.match(PKG_RE);
    if (pkgMatch) pkg = pkgMatch[0].toUpperCase();

    const barcode = location ? `${location}-${code}` : "";

    parts.push({
      id: crypto.randomUUID(),
      item_code: code,
      item_name: name,
      package: pkg,
      location,
      details: name,
      qty,
      barcode,
    });
    code++;
  }

  return parts;
}

function parseTabularFormat(
  lines: string[],
  startCode: number,
  location: string
): QueuedPart[] {
  // Detect delimiter from first line: tab or multiple spaces
  const delimiter = lines[0].includes("\t") ? "\t" : /\s{2,}/;

  const firstCols = lines[0].split(delimiter).map((c) => c.trim());

  // Check if first row is a header
  const colMap = detectHeader(firstCols);
  const hasHeader = colMap !== null;
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const parts: QueuedPart[] = [];
  let code = startCode;

  for (const line of dataLines) {
    if (SKIP_LINE_RE.test(line)) continue;

    const cols = line.split(delimiter).map((c) => c.trim()).filter(Boolean);
    if (cols.length === 0) continue;

    let name = "";
    let qty = 0;
    let pkg = "";
    let details = "";

    if (hasHeader && colMap) {
      name = colMap.name >= 0 ? (cols[colMap.name] ?? "") : "";
      qty =
        colMap.qty >= 0 ? parseInt(cols[colMap.qty] ?? "0") || 0 : 0;
      pkg = colMap.pkg >= 0 ? (cols[colMap.pkg] ?? "") : "";
      details = colMap.details >= 0 ? (cols[colMap.details] ?? "") : "";
    } else {
      const parsed = classifyColumnsHeuristic(cols);
      name = parsed.name;
      qty = parsed.qty;
      pkg = parsed.pkg;
      details = parsed.details;
    }

    if (!name) continue;

    if (!details) details = name;

    if (!pkg) {
      const pkgMatch = name.match(PKG_RE);
      if (pkgMatch) pkg = pkgMatch[0].toUpperCase();
    }

    const barcode = location ? `${location}-${code}` : "";

    parts.push({
      id: crypto.randomUUID(),
      item_code: code,
      item_name: name,
      package: pkg,
      location,
      details,
      qty,
      barcode,
    });
    code++;
  }

  return parts;
}

function classifyColumnsHeuristic(cols: string[]): {
  name: string;
  qty: number;
  pkg: string;
  details: string;
} {
  let name = "";
  let qty = 0;
  let pkg = "";
  const details = "";

  const pricePattern = /^[₹$€£¥]\s?\d[\d,.]*$/;
  const numPattern = /^\d+$/;

  const textCols: string[] = [];
  const numbers: number[] = [];

  for (const col of cols) {
    if (pricePattern.test(col)) continue;
    if (numPattern.test(col)) {
      numbers.push(parseInt(col));
      continue;
    }
    if (col.length > 3) textCols.push(col);
  }

  // Deduplicate text columns (image alt = name)
  const uniqueText = [...new Set(textCols)];
  if (uniqueText.length > 0) {
    name = uniqueText.reduce((a, b) => (a.length >= b.length ? a : b));
  }

  // Extract package from name
  const pkgMatch = name.match(PKG_RE);
  if (pkgMatch) pkg = pkgMatch[0].toUpperCase();

  // Qty is the last number (rightmost column is usually quantity in order tables)
  if (numbers.length > 0) {
    qty = numbers[numbers.length - 1];
  }

  return { name, qty, pkg, details };
}

// --- Component ---

export default function NewPartPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueuedPart[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0 });
  const [nextCode, setNextCode] = useState(0);
  const [packages, setPackages] = useState<string[]>([]);
  const [showPkgDropdown, setShowPkgDropdown] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [editingPart, setEditingPart] = useState<QueuedPart | null>(null);
  const pkgRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    item_name: "",
    package: "",
    location: "",
    details: "",
    qty: 0,
  });

  const loadNextCode = useCallback(async () => {
    const code = await getNextItemCode();
    setNextCode(code);
  }, []);

  useEffect(() => {
    loadNextCode();
    getPackages().then(setPackages);
    const lastLoc = localStorage.getItem(LAST_LOCATION_KEY);
    if (lastLoc) {
      setForm((prev) => ({ ...prev, location: lastLoc }));
    }
  }, [loadNextCode]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pkgRef.current && !pkgRef.current.contains(e.target as Node)) {
        setShowPkgDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const currentCode = nextCode + queue.length;
  const barcode =
    form.location && currentCode
      ? `${form.location}-${currentCode}`
      : "";

  const filteredPackages = form.package
    ? packages.filter((p) =>
        p.toLowerCase().includes(form.package.toLowerCase())
      )
    : packages;

  function addToQueue() {
    if (!form.item_name.trim()) return;

    const part: QueuedPart = {
      id: crypto.randomUUID(),
      item_code: currentCode,
      item_name: form.item_name.trim(),
      package: form.package.trim(),
      location: form.location.trim(),
      details: form.details.trim(),
      qty: form.qty,
      barcode,
    };

    setQueue((prev) => [...prev, part]);

    if (form.location) {
      localStorage.setItem(LAST_LOCATION_KEY, form.location);
    }

    setForm((prev) => ({
      item_name: "",
      package: "",
      location: prev.location,
      details: "",
      qty: 0,
    }));
  }

  function handlePasteImport() {
    if (!pasteText.trim()) return;
    const startCode = nextCode + queue.length;
    const location = form.location.trim();
    const parsed = parsePastedText(pasteText, startCode, location);

    if (parsed.length === 0) {
      toast.error("Could not parse any parts from the pasted text");
      return;
    }

    setQueue((prev) => [...prev, ...parsed]);
    setPasteText("");
    setShowPaste(false);
    toast.success(`Added ${parsed.length} parts to queue`);
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((p) => p.id !== id));
  }

  function updateInQueue(updated: QueuedPart) {
    // Recalculate barcode from location + item_code
    updated.barcode =
      updated.location && updated.item_code
        ? `${updated.location}-${updated.item_code}`
        : "";
    setQueue((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setEditingPart(null);
  }

  async function saveAll() {
    if (queue.length === 0) return;
    setSaving(true);
    setSaveProgress({ done: 0, total: queue.length });

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      try {
        await createPart({
          barcode: p.barcode || null,
          item_code: p.item_code,
          item_name: p.item_name,
          package: p.package || null,
          location: p.location || null,
          details: p.details || null,
          qty: p.qty,
          bin_number: null,
        });
        succeeded++;
      } catch {
        failed++;
      }
      setSaveProgress({ done: i + 1, total: queue.length });
    }

    setSaving(false);

    if (failed === 0) {
      toast.success(`Saved ${succeeded} part${succeeded > 1 ? "s" : ""}`);
      setQueue([]);
      router.push("/");
    } else {
      toast.error(
        `${succeeded} saved, ${failed} failed. Check for duplicate item codes.`
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Add Parts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Queue multiple parts, then save all at once
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPaste(true)}
          className="border-primary/30 text-primary hover:bg-primary/10 shrink-0"
        >
          Paste order
        </Button>
      </div>

      {/* Form card */}
      <div className="rounded-xl border border-border/50 bg-card p-5 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Barcode
            </Label>
            <div className="h-9 px-3 flex items-center rounded-lg bg-muted/50 border border-border/30 font-mono text-sm text-muted-foreground">
              {barcode || "--"}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="item_code" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Item Code
            </Label>
            <Input
              id="item_code"
              type="number"
              value={currentCode || ""}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setNextCode(val - queue.length);
              }}
              className="font-mono bg-secondary border-border/50"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="item_name" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Item Name
          </Label>
          <Input
            id="item_name"
            value={form.item_name}
            onChange={(e) => setForm({ ...form, item_name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addToQueue();
              }
            }}
            autoFocus
            required
            className="bg-secondary border-border/50"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 relative" ref={pkgRef}>
            <Label htmlFor="package" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Package
            </Label>
            <Input
              id="package"
              value={form.package}
              onChange={(e) => {
                setForm({ ...form, package: e.target.value });
                setShowPkgDropdown(true);
              }}
              onFocus={() => setShowPkgDropdown(true)}
              placeholder="TO-92, DIP-14..."
              autoComplete="off"
              className="font-mono bg-secondary border-border/50"
            />
            {showPkgDropdown && filteredPackages.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                {filteredPackages.map((pkg) => (
                  <button
                    key={pkg}
                    type="button"
                    onClick={() => {
                      setForm({ ...form, package: pkg });
                      setShowPkgDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm font-mono hover:bg-accent transition-colors"
                  >
                    {pkg}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="location" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Location
            </Label>
            <Input
              id="location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="B1, B3, RED..."
              className="font-mono bg-secondary border-border/50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="details" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Details
            </Label>
            <Textarea
              id="details"
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              rows={2}
              className="bg-secondary border-border/50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="qty" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Qty Available
            </Label>
            <Input
              id="qty"
              type="number"
              value={form.qty}
              onChange={(e) =>
                setForm({ ...form, qty: parseInt(e.target.value) || 0 })
              }
              className="font-mono bg-secondary border-border/50"
            />
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={addToQueue}
          disabled={!form.item_name.trim()}
          className="w-full border-primary/30 text-primary hover:bg-primary/10"
        >
          + Add to queue
        </Button>
      </div>

      {/* Queue list */}
      {queue.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Queue ({queue.length})
            </h2>
            <Button onClick={saveAll} size="lg">
              Save {queue.length} part{queue.length > 1 ? "s" : ""}
            </Button>
          </div>

          <div className="space-y-2">
            {queue.map((part) => (
              <div
                key={part.id}
                className="group flex items-center justify-between p-3 rounded-xl border border-border/50 bg-card hover:border-border transition-all"
              >
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => setEditingPart({ ...part })}
                >
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
                  <div className="text-xs text-muted-foreground font-mono mt-0.5">
                    {part.barcode || `#${part.item_code}`}
                    {part.location && (
                      <span className="text-primary/70 ml-2 font-sans">{part.location}</span>
                    )}
                    {part.qty > 0 && (
                      <span className="ml-2">qty: {part.qty}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <button
                    onClick={() => setEditingPart({ ...part })}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-all p-1"
                    title="Edit"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => removeFromQueue(part.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                    title="Remove"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paste order dialog */}
      <Dialog open={showPaste} onOpenChange={setShowPaste}>
        <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Paste from order</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground shrink-0">
            Paste a table from an order confirmation, invoice, or spreadsheet.
            Tab-separated or multi-space columns are auto-detected.
          </p>
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Product Name\tModel\tQuantity\tPrice\nLM2596 DC-DC Step Down\t265\t10\t₹43\nINA226 Power Sensor\t2832\t5\t₹100`}
            rows={6}
            className="font-mono text-xs bg-secondary border-border/50 min-h-[120px] max-h-[40dvh] flex-1"
            autoFocus
          />
          {pasteText.trim() && (
            <div className="text-xs text-muted-foreground">
              Preview: {pasteText.split("\n").filter((l) => l.trim()).length} lines detected
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setShowPaste(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePasteImport}
              disabled={!pasteText.trim()}
            >
              Add to queue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit queued part dialog */}
      <Dialog open={!!editingPart} onOpenChange={(open) => !open && setEditingPart(null)}>
        <DialogContent className="sm:max-w-lg max-h-[85dvh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit part</DialogTitle>
          </DialogHeader>
          {editingPart && (
            <div className="space-y-4 flex-1 overflow-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Barcode</Label>
                  <div className="h-9 px-3 flex items-center rounded-lg bg-muted/50 border border-border/30 font-mono text-sm text-muted-foreground">
                    {editingPart.location && editingPart.item_code
                      ? `${editingPart.location}-${editingPart.item_code}`
                      : "--"}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item Code</Label>
                  <div className="h-9 px-3 flex items-center rounded-lg bg-muted/50 border border-border/30 font-mono text-sm text-muted-foreground">
                    {editingPart.item_code}
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item Name</Label>
                <Input
                  value={editingPart.item_name}
                  onChange={(e) => setEditingPart({ ...editingPart, item_name: e.target.value })}
                  className="bg-secondary border-border/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Package</Label>
                  <Input
                    value={editingPart.package}
                    onChange={(e) => setEditingPart({ ...editingPart, package: e.target.value })}
                    placeholder="TO-92, DIP-14..."
                    className="font-mono bg-secondary border-border/50"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location</Label>
                  <Input
                    value={editingPart.location}
                    onChange={(e) => setEditingPart({ ...editingPart, location: e.target.value })}
                    placeholder="B1, B3, RED..."
                    className="font-mono bg-secondary border-border/50"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Details</Label>
                  <Textarea
                    value={editingPart.details}
                    onChange={(e) => setEditingPart({ ...editingPart, details: e.target.value })}
                    rows={2}
                    className="bg-secondary border-border/50"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Qty</Label>
                  <Input
                    type="number"
                    value={editingPart.qty}
                    onChange={(e) => setEditingPart({ ...editingPart, qty: parseInt(e.target.value) || 0 })}
                    className="font-mono bg-secondary border-border/50"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="ghost" onClick={() => setEditingPart(null)}>
                  Cancel
                </Button>
                <Button onClick={() => updateInQueue(editingPart)}>
                  Update
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Saving modal */}
      <Dialog open={saving}>
        <DialogContent className="sm:max-w-sm [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Saving parts...</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${saveProgress.total > 0 ? (saveProgress.done / saveProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              {saveProgress.done} / {saveProgress.total}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
