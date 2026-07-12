"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BoxLabelGrid } from "@/components/box-label-grid";
import { BinLabelGrid } from "@/components/bin-label-grid";
import { getBoxes } from "@/lib/actions";
import type { Box } from "@/lib/types";

export default function LabelsPage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [labelType, setLabelType] = useState<"boxes" | "bins">("boxes");
  const [selectedBoxes, setSelectedBoxes] = useState<Set<string>>(new Set());

  // Bin-sticker print queue: boxes whose bins go on the next sheet. Session-only
  // — a queue that outlives the tab would silently reprint stickers you already
  // stuck on a box.
  const [binQueue, setBinQueue] = useState<Set<string>>(new Set());

  useEffect(() => {
    getBoxes().then(setBoxes);
  }, []);

  const selectedBoxList = boxes.filter((b) => selectedBoxes.has(b.id));
  const queuedBoxes = boxes.filter((b) => binQueue.has(b.id));
  const queuedLabelCount = queuedBoxes.reduce((n, b) => n + b.bin_count, 0);

  function toggleAllBoxes(checked: boolean) {
    setSelectedBoxes(checked ? new Set(boxes.map((b) => b.id)) : new Set());
  }

  function toggleBox(id: string) {
    const next = new Set(selectedBoxes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBoxes(next);
  }

  function toggleBinQueue(id: string) {
    const next = new Set(binQueue);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setBinQueue(next);
  }

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="print:hidden space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Labels</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Print box lids and bin compartment numbers
          </p>
        </div>

        <div className="flex gap-2">
          <FilterChip
            active={labelType === "boxes"}
            onClick={() => setLabelType("boxes")}
          >
            Box Labels
          </FilterChip>
          <FilterChip
            active={labelType === "bins"}
            onClick={() => setLabelType("bins")}
          >
            Bin Numbers
          </FilterChip>
        </div>

        {labelType === "boxes" && (
          <>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={
                    boxes.length > 0 &&
                    boxes.every((b) => selectedBoxes.has(b.id))
                  }
                  onChange={(e) => toggleAllBoxes(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                <span className="text-muted-foreground">
                  Select all ({boxes.length})
                </span>
              </label>
              {selectedBoxes.size > 0 && (
                <span className="text-xs text-primary font-medium">
                  {selectedBoxes.size} selected (2 copies each)
                </span>
              )}
            </div>

            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <tbody>
                    {boxes.map((box) => (
                      <tr
                        key={box.id}
                        className="border-t border-border/30 hover:bg-accent/50 cursor-pointer"
                        onClick={() => toggleBox(box.id)}
                      >
                        <td className="p-3 w-8">
                          <input
                            type="checkbox"
                            checked={selectedBoxes.has(box.id)}
                            onChange={() => toggleBox(box.id)}
                            className="accent-primary"
                          />
                        </td>
                        <td className="p-3 font-semibold">{box.id}</td>
                        <td className="p-3 text-muted-foreground text-xs">
                          {box.bin_count} bins ({box.rows}×{box.cols})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button
              onClick={() => window.print()}
              disabled={selectedBoxes.size === 0}
              size="lg"
            >
              Print {selectedBoxes.size} box labels ({selectedBoxes.size * 2}{" "}
              copies)
            </Button>
          </>
        )}

        {labelType === "bins" && (
          <>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                Queue boxes, then print every sticker on one sheet.
              </span>
              {binQueue.size > 0 && (
                <button
                  onClick={() => setBinQueue(new Set())}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-auto"
                >
                  Clear queue
                </button>
              )}
            </div>

            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <tbody>
                    {boxes.map((box) => (
                      <tr
                        key={box.id}
                        className="border-t border-border/30 hover:bg-accent/50 cursor-pointer"
                        onClick={() => toggleBinQueue(box.id)}
                      >
                        <td className="p-3 w-8">
                          <input
                            type="checkbox"
                            checked={binQueue.has(box.id)}
                            onChange={() => toggleBinQueue(box.id)}
                            className="accent-primary"
                          />
                        </td>
                        <td className="p-3 font-semibold">{box.id}</td>
                        <td className="p-3 text-muted-foreground text-xs font-mono">
                          {box.id}:1 – {box.id}:{box.bin_count}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs text-right">
                          {box.bin_count} stickers
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {queuedLabelCount > 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="text-primary font-medium">
                  {queuedLabelCount} stickers
                </span>{" "}
                queued from {queuedBoxes.length} box
                {queuedBoxes.length > 1 ? "es" : ""} ·{" "}
                {queuedBoxes.map((b) => b.id).join(", ")} · 20×10mm each
              </p>
            )}

            <Button
              onClick={() => window.print()}
              disabled={queuedLabelCount === 0}
              size="lg"
            >
              {queuedLabelCount > 0
                ? `Print ${queuedLabelCount} bin stickers`
                : "Queue a box"}
            </Button>
          </>
        )}
      </div>

      {labelType === "boxes" && selectedBoxList.length > 0 && (
        <BoxLabelGrid boxes={selectedBoxList} />
      )}
      {labelType === "bins" && queuedBoxes.length > 0 && (
        <BinLabelGrid boxes={queuedBoxes} />
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
          : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
