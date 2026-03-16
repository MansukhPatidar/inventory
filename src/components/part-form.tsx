"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createPart,
  updatePart,
  getNextItemCode,
  getPackages,
} from "@/lib/actions";
import type { Part } from "@/lib/types";

const LAST_LOCATION_KEY = "inventory-last-location";

export function PartForm({ part }: { part?: Part }) {
  const router = useRouter();
  const isNew = !part;
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<string[]>([]);
  const [showPkgDropdown, setShowPkgDropdown] = useState(false);
  const pkgRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    item_code: part?.item_code ?? 0,
    item_name: part?.item_name ?? "",
    package: part?.package ?? "",
    location: part?.location ?? "",
    details: part?.details ?? "",
    qty: part?.qty ?? 0,
  });

  useEffect(() => {
    getPackages().then(setPackages);

    if (isNew) {
      getNextItemCode().then((code) =>
        setFormData((prev) => ({ ...prev, item_code: code }))
      );
      // Auto-fill last used location
      const lastLoc = localStorage.getItem(LAST_LOCATION_KEY);
      if (lastLoc) {
        setFormData((prev) => ({ ...prev, location: lastLoc }));
      }
    }
  }, [isNew]);

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

  // Generate barcode from location + item_code
  const barcode =
    formData.location && formData.item_code
      ? `${formData.location}-${formData.item_code}`
      : formData.item_code
      ? `${formData.item_code}`
      : "";

  const filteredPackages = formData.package
    ? packages.filter((p) =>
        p.toLowerCase().includes(formData.package.toLowerCase())
      )
    : packages;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Remember location for next time
      if (formData.location) {
        localStorage.setItem(LAST_LOCATION_KEY, formData.location);
      }

      if (part) {
        await updatePart(part.id, {
          barcode: barcode || undefined,
          item_name: formData.item_name,
          package: formData.package || undefined,
          location: formData.location || undefined,
          details: formData.details || undefined,
          qty: formData.qty,
        });
        router.push(`/parts/${part.id}`);
      } else {
        const created = await createPart({
          barcode: barcode || null,
          item_code: formData.item_code,
          item_name: formData.item_name,
          package: formData.package || null,
          location: formData.location || null,
          details: formData.details || null,
          qty: formData.qty,
        });
        router.push(`/parts/${created.id}`);
      }
      router.refresh();
    } catch (e) {
      alert("Error: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Auto-generated fields - read only */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Barcode
          </Label>
          <div className="h-9 px-3 flex items-center rounded-lg bg-muted/50 border border-border/30 font-mono text-sm text-muted-foreground">
            {barcode || "auto-generated"}
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Item Code
          </Label>
          <div className="h-9 px-3 flex items-center rounded-lg bg-muted/50 border border-border/30 font-mono text-sm text-muted-foreground">
            {formData.item_code || "..."}
          </div>
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
        {/* Package - typable combobox */}
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

        {/* Location - editable, remembers last */}
        <div className="space-y-2">
          <Label htmlFor="location" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Location
          </Label>
          <Input
            id="location"
            value={formData.location}
            onChange={(e) =>
              setFormData({ ...formData, location: e.target.value })
            }
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
