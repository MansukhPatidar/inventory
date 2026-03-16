"use client";

import Link from "next/link";
import type { Box, Part } from "@/lib/types";

/**
 * Extract the bin number from a barcode like "B1-3" → 3.
 * Falls back to the part's index in the array if barcode doesn't match.
 */
function binNumber(part: Part): number {
  if (part.barcode) {
    const dash = part.barcode.lastIndexOf("-");
    if (dash !== -1) {
      const num = parseInt(part.barcode.slice(dash + 1));
      if (!isNaN(num)) return num;
    }
  }
  return part.item_code;
}

export function BoxGrid({
  box,
  parts,
  onEdit,
}: {
  box: Box;
  parts: Part[];
  onEdit: () => void;
}) {
  // Map bin number → part
  const binMap = new Map<number, Part>();
  for (const part of parts) {
    binMap.set(binNumber(part), part);
  }

  // Find all bin numbers used to determine the range
  const usedBins = parts.map(binNumber);
  const maxBin = usedBins.length > 0 ? Math.max(...usedBins) : 0;
  const totalSlots = Math.max(box.bin_count, maxBin);

  const used = parts.length;
  const fillPct = totalSlots > 0 ? (used / totalSlots) * 100 : 0;
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
            {used}/{totalSlots} bins
          </span>
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
      <div className="p-3 grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
        {Array.from({ length: totalSlots }, (_, i) => {
          const binNum = i + 1;
          const part = binMap.get(binNum);

          if (part) {
            return (
              <Link
                key={binNum}
                href={`/parts?id=${part.id}`}
                className="group relative flex flex-col items-center justify-center rounded-lg border border-primary/25 bg-primary/10 hover:bg-primary/20 transition-colors p-1.5 min-h-[52px]"
                title={`#${binNum} ${part.item_name}${part.qty === 0 ? " (empty)" : ""}`}
              >
                <span className="text-[10px] font-mono text-primary/60 leading-none">
                  {binNum}
                </span>
                <span className="text-[10px] text-center leading-tight mt-0.5 text-foreground/80 line-clamp-2 break-all">
                  {part.item_name.length > 12
                    ? part.item_name.slice(0, 11) + "…"
                    : part.item_name}
                </span>
                {part.qty === 0 && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                )}
              </Link>
            );
          }

          return (
            <div
              key={binNum}
              className="flex items-center justify-center rounded-lg border border-dashed border-border/30 bg-muted/20 min-h-[52px]"
            >
              <span className="text-[10px] font-mono text-muted-foreground/40">
                {binNum}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
