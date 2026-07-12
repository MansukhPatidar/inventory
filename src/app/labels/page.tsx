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
  const [binBoxId, setBinBoxId] = useState<string | null>(null);

  useEffect(() => {
    getBoxes().then(setBoxes);
  }, []);

  const selectedBoxList = boxes.filter((b) => selectedBoxes.has(b.id));
  const binBox = boxes.find((b) => b.id === binBoxId) ?? null;

  function toggleAllBoxes(checked: boolean) {
    setSelectedBoxes(checked ? new Set(boxes.map((b) => b.id)) : new Set());
  }

  function toggleBox(id: string) {
    const next = new Set(selectedBoxes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBoxes(next);
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
            <div className="flex gap-2 flex-wrap">
              {boxes.map((box) => (
                <FilterChip
                  key={box.id}
                  active={binBoxId === box.id}
                  onClick={() => setBinBoxId(box.id)}
                >
                  {box.id}
                </FilterChip>
              ))}
            </div>

            {binBox && (
              <p className="text-sm text-muted-foreground">
                {binBox.bin_count} bin stickers, laid out {binBox.rows}×
                {binBox.cols} to match the box.
              </p>
            )}

            <Button
              onClick={() => window.print()}
              disabled={!binBox}
              size="lg"
            >
              {binBox
                ? `Print ${binBox.bin_count} bin numbers for ${binBox.id}`
                : "Pick a box"}
            </Button>
          </>
        )}
      </div>

      {labelType === "boxes" && selectedBoxList.length > 0 && (
        <BoxLabelGrid boxes={selectedBoxList} />
      )}
      {labelType === "bins" && binBox && <BinLabelGrid box={binBox} />}
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
