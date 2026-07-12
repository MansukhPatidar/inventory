"use client";

import type { Box } from "@/lib/types";

// Bin stickers: 15mm squares, one per compartment, laid out in the box's own
// rows × cols so the printed sheet matches the physical box face. Sizes are
// fixed in mm — a sticker that scales with the viewport is a sticker that does
// not fit the compartment it was printed for.

const BIN_STICKER_MM = 15;

export function BinLabelGrid({ box }: { box: Box }) {
  const bins = Array.from({ length: box.bin_count }, (_, i) => i + 1);

  return (
    <div className="label-print-area hidden print:block">
      <div className="mb-3">
        <span className="text-lg font-bold text-black">{box.id}</span>
        <span className="text-xs ml-2 text-black/60">
          bins 1–{box.bin_count} ({box.rows}×{box.cols})
        </span>
      </div>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${box.cols}, ${BIN_STICKER_MM}mm)`,
          gap: "1mm",
        }}
      >
        {bins.map((bin) => (
          <div
            key={bin}
            className="flex items-center justify-center border border-dashed border-black/40"
            style={{ width: `${BIN_STICKER_MM}mm`, height: `${BIN_STICKER_MM}mm` }}
          >
            <span className="text-2xl font-bold font-mono text-black">
              {bin}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
