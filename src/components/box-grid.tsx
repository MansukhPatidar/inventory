"use client";

import Link from "next/link";
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

  // Separate parts with explicit bin_number (shared) from auto-assigned ones
  const sharedBins = new Map<number, Part[]>();
  const autoParts: Part[] = [];

  for (const part of parts) {
    if (part.bin_number != null) {
      if (!sharedBins.has(part.bin_number)) sharedBins.set(part.bin_number, []);
      sharedBins.get(part.bin_number)!.push(part);
    } else {
      autoParts.push(part);
    }
  }

  // Build bin slots: first place shared bins at their positions, then fill remaining with auto parts
  const bins: (Part[] | null)[] = Array.from({ length: totalSlots }, () => null);

  // Place shared bins
  for (const [binNum, binParts] of sharedBins) {
    if (binNum >= 1 && binNum <= totalSlots) {
      bins[binNum - 1] = binParts;
    }
  }

  // Fill auto parts into empty slots
  let autoIdx = 0;
  for (let i = 0; i < totalSlots && autoIdx < autoParts.length; i++) {
    if (bins[i] === null) {
      bins[i] = [autoParts[autoIdx]];
      autoIdx++;
    }
  }

  const usedCount = bins.filter((b) => b !== null).length;
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
        {bins.map((binParts, i) => {
          const binNum = i + 1;

          if (binParts && binParts.length > 0) {
            const isShared = binParts.length > 1;
            const first = binParts[0];

            if (isShared) {
              return (
                <div
                  key={binNum}
                  className="relative flex flex-col items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 p-1.5 min-h-[52px]"
                  title={binParts.map((p) => p.item_name).join(", ")}
                >
                  <span className="text-[10px] font-mono text-amber-500/60 leading-none">
                    {binNum}
                  </span>
                  <span className="text-[9px] text-center leading-tight mt-0.5 text-foreground/70 line-clamp-2">
                    {binParts.length} parts
                  </span>
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                </div>
              );
            }

            return (
              <Link
                key={binNum}
                href={`/parts?id=${first.id}`}
                className="group relative flex flex-col items-center justify-center rounded-lg border border-primary/25 bg-primary/10 hover:bg-primary/20 transition-colors p-1.5 min-h-[52px]"
                title={`#${binNum} ${first.item_name}${first.qty === 0 ? " (empty)" : ""}`}
              >
                <span className="text-[10px] font-mono text-primary/60 leading-none">
                  {binNum}
                </span>
                <span className="text-[10px] text-center leading-tight mt-0.5 text-foreground/80 line-clamp-2 break-all">
                  {first.item_name.length > 12
                    ? first.item_name.slice(0, 11) + "…"
                    : first.item_name}
                </span>
                {first.qty === 0 && (
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
