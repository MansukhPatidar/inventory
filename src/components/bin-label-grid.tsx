"use client";

import type { Box } from "@/lib/types";

// Bin stickers: 20mm × 10mm, one per compartment, reading "B9:1" — the box id
// dim, the bin number bold, since the box id is already printed on the lid and
// the bin number is what you actually scan for with your eyes.
//
// Sizes are fixed in mm. A sticker that scales with the viewport is a sticker
// that does not fit the compartment it was printed for.
//
// Labels from every queued box flow across the page in one continuous grid.
// This is a batch sheet to cut up, not a map of a box's face.

const LABEL_W_MM = 20;
const LABEL_H_MM = 10;
const GAP_MM = 1;
const PAGE_W_MM = 200; // A4 (210mm) less the 5mm @page margins, with slack

const PER_ROW = Math.floor((PAGE_W_MM + GAP_MM) / (LABEL_W_MM + GAP_MM));

export function BinLabelGrid({ boxes }: { boxes: Box[] }) {
  const labels = boxes.flatMap((box) =>
    Array.from({ length: box.bin_count }, (_, i) => ({
      boxId: box.id,
      bin: i + 1,
    }))
  );

  return (
    <div className="label-print-area hidden print:block">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${PER_ROW}, ${LABEL_W_MM}mm)`,
          gap: `${GAP_MM}mm`,
        }}
      >
        {labels.map(({ boxId, bin }) => (
          <div
            key={`${boxId}-${bin}`}
            className="flex items-center justify-center border border-dashed border-black/30 bg-white"
            style={{ width: `${LABEL_W_MM}mm`, height: `${LABEL_H_MM}mm` }}
          >
            <span className="font-mono leading-none text-black">
              <span style={{ fontSize: "7pt" }} className="text-black/55">
                {boxId}:
              </span>
              <span style={{ fontSize: "12pt" }} className="font-bold">
                {bin}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
