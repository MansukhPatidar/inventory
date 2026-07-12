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
