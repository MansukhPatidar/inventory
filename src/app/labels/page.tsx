"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LabelGrid } from "@/components/label-grid";
import { BoxLabelGrid } from "@/components/box-label-grid";
import { getParts, getLocations, getBoxes } from "@/lib/actions";
import type { Part, Box } from "@/lib/types";

export default function LabelsPage() {
  const [allParts, setAllParts] = useState<Part[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedBoxes, setSelectedBoxes] = useState<Set<string>>(new Set());
  const [filterLocation, setFilterLocation] = useState<string | null>(null);
  const [labelType, setLabelType] = useState<"parts" | "boxes">("parts");

  useEffect(() => {
    getParts().then(setAllParts);
    getLocations().then(setLocations);
    getBoxes().then(setBoxes);
  }, []);

  const displayed = filterLocation
    ? allParts.filter((p) => p.location === filterLocation)
    : allParts;

  const selectedParts = allParts.filter((p) => selected.has(p.id));
  const selectedBoxList = boxes.filter((b) => selectedBoxes.has(b.id));

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(displayed.map((p) => p.id)));
    } else {
      setSelected(new Set());
    }
  }

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAllBoxes(checked: boolean) {
    if (checked) {
      setSelectedBoxes(new Set(boxes.map((b) => b.id)));
    } else {
      setSelectedBoxes(new Set());
    }
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
            Select parts or boxes and print QR label sheets
          </p>
        </div>

        {/* Label type toggle */}
        <div className="flex gap-2">
          <FilterChip
            active={labelType === "parts"}
            onClick={() => setLabelType("parts")}
          >
            Part Labels
          </FilterChip>
          <FilterChip
            active={labelType === "boxes"}
            onClick={() => setLabelType("boxes")}
          >
            Box Labels
          </FilterChip>
        </div>

        {labelType === "parts" && (
          <>
            <div className="flex gap-2 flex-wrap">
              <FilterChip
                active={filterLocation === null}
                onClick={() => setFilterLocation(null)}
              >
                All
              </FilterChip>
              {locations.map((loc) => (
                <FilterChip
                  key={loc}
                  active={filterLocation === loc}
                  onClick={() => setFilterLocation(loc)}
                >
                  {loc}
                </FilterChip>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={
                    displayed.length > 0 &&
                    displayed.every((p) => selected.has(p.id))
                  }
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="rounded border-border accent-primary"
                />
                <span className="text-muted-foreground">
                  Select all ({displayed.length})
                </span>
              </label>
              {selected.size > 0 && (
                <span className="text-xs text-primary font-medium">
                  {selected.size} selected
                </span>
              )}
            </div>

            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <tbody>
                    {displayed.map((part) => (
                      <tr
                        key={part.id}
                        className="border-t border-border/30 hover:bg-accent/50 cursor-pointer"
                        onClick={() => toggle(part.id)}
                      >
                        <td className="p-3 w-8">
                          <input
                            type="checkbox"
                            checked={selected.has(part.id)}
                            onChange={() => toggle(part.id)}
                            className="accent-primary"
                          />
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {part.barcode}
                        </td>
                        <td className="p-3">{part.item_name}</td>
                        <td className="p-3 text-muted-foreground font-mono text-xs">
                          {part.package}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button
              onClick={() => window.print()}
              disabled={selected.size === 0}
              size="lg"
            >
              Print {selected.size} labels
            </Button>
          </>
        )}

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
      </div>

      {labelType === "parts" && selectedParts.length > 0 && (
        <LabelGrid parts={selectedParts} />
      )}
      {labelType === "boxes" && selectedBoxList.length > 0 && (
        <BoxLabelGrid boxes={selectedBoxList} />
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
