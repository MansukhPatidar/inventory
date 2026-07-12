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
