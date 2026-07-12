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
import {
  isOutOfRange,
  formatAddress,
  allocateBins,
  OCCUPANCY_UNKNOWN,
  type BoxOccupancy,
} from "@/lib/bins";
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
  // OCCUPANCY_UNKNOWN means "haven't read this box yet, or the read failed" —
  // distinct from an empty array ("read it, it's empty"). Conflating the two
  // (e.g. via a bare `.catch(() => setBoxParts([]))`) is what lets a failed
  // fetch masquerade as an empty box: binMates would come up empty, the
  // amber "sharing this bin" warning would never fire, and the user would
  // get a false all-clear to stack a part onto an occupied bin.
  const [boxParts, setBoxParts] = useState<
    | typeof OCCUPANCY_UNKNOWN
    | { id: number; item_name: string; item_code: number; bin_number: number }[]
  >(OCCUPANCY_UNKNOWN);

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
  // who is already in the bin you typed. While the fetch is in flight — and if
  // it fails — occupancy stays OCCUPANCY_UNKNOWN, never `[]`. A bare `[]` there
  // would make a failed fetch indistinguishable from "box is genuinely empty",
  // which both suppresses the binMates warning and lets auto-allocation hand
  // out bin 1 on top of an existing occupant.
  useEffect(() => {
    if (!formData.location) {
      setBoxParts(OCCUPANCY_UNKNOWN);
      return;
    }
    setBoxParts(OCCUPANCY_UNKNOWN);
    const location = formData.location;
    getPartsInBox(location)
      .then((parts) => {
        setBoxParts(parts);
        // A new part in a freshly-chosen box defaults to the first free bin.
        // Routed through allocateBins so it inherits the unknown-occupancy
        // refusal — hand-rolling nextFreeBin here would reopen the exact bin-
        // collision bug that allocateBins exists to close.
        setFormData((prev) => {
          if (!isNew || prev.bin_number !== 0 || prev.location !== location)
            return prev;
          const occupancy: BoxOccupancy = parts.map((p) => ({
            location,
            bin_number: p.bin_number,
          }));
          const bins = allocateBins(location, 1, occupancy, []);
          if (!bins) return prev;
          return { ...prev, bin_number: bins[0] };
        });
      })
      .catch(() => {
        setBoxParts(OCCUPANCY_UNKNOWN);
        toast.error(
          `Could not read contents of box ${location}. Bin info may be incomplete.`
        );
      });
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

  const boxPartsKnown = boxParts !== OCCUPANCY_UNKNOWN;
  // While occupancy is unknown, binMates MUST stay empty rather than fall
  // back to `[]` from a stale/failed fetch — but that emptiness must not be
  // read as "this bin is free" (see the boxPartsKnown-gated warning below).
  const binMates = boxPartsKnown
    ? boxParts.filter(
        (p) => p.bin_number === formData.bin_number && p.id !== part?.id
      )
    : [];

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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
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
        <div className="space-y-2">
          <Label htmlFor="item_code" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Item Code
          </Label>
          <Input
            id="item_code"
            type="number"
            value={formData.item_code || ""}
            onChange={(e) =>
              setFormData({ ...formData, item_code: parseInt(e.target.value) || 0 })
            }
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
          value={formData.item_name}
          onChange={(e) =>
            setFormData({ ...formData, item_name: e.target.value })
          }
          required
          autoFocus
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
            value={formData.package}
            onChange={(e) => {
              setFormData({ ...formData, package: e.target.value });
              setShowPkgDropdown(true);
            }}
            onFocus={() => setShowPkgDropdown(true)}
            placeholder="TO-92, DIP-14, 0805..."
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
                    setFormData({ ...formData, package: pkg });
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
        {formData.location && !boxPartsKnown && (
          <p className="text-xs text-amber-400">
            Could not read this box&apos;s contents — cannot confirm whether
            this bin is free.
          </p>
        )}
        {binMates.length > 0 && (
          <p className="text-xs text-amber-400">
            Sharing this bin with: {binMates.map((p) => p.item_name).join(", ")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="details" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Details
          </Label>
          <Textarea
            id="details"
            value={formData.details}
            onChange={(e) =>
              setFormData({ ...formData, details: e.target.value })
            }
            rows={3}
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
            value={formData.qty}
            onChange={(e) =>
              setFormData({ ...formData, qty: parseInt(e.target.value) || 0 })
            }
            className="font-mono bg-secondary border-border/50"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={loading} size="lg">
          {loading ? "Saving..." : part ? "Update Part" : "Create Part"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
