"use client";

import { useEffect, useRef, useMemo } from "react";
import QRCode from "qrcode";
import type { Part } from "@/lib/types";

// Label size: 12mm tall x 40mm wide
// Gap: 10px between labels, cut line runs through gap midpoint

export function LabelGrid({ parts }: { parts: Part[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const canvases = containerRef.current.querySelectorAll("canvas[data-qr]");
    canvases.forEach((canvas) => {
      const code = canvas.getAttribute("data-qr");
      if (code) {
        QRCode.toCanvas(canvas as HTMLCanvasElement, code, {
          width: 40,
          margin: 0,
          color: { dark: "#000000", light: "#ffffff" },
        });
      }
    });
  }, [parts]);

  // Calculate grid dimensions
  const cols = useMemo(() => {
    if (typeof window === "undefined") return 4;
    // 40mm ≈ 151px at 96dpi, 10px gap
    // Fit as many as possible in container width (~600px for max-w-2xl)
    return Math.max(1, Math.floor((600 + 10) / (151 + 10)));
  }, []);

  const rows = Math.ceil(parts.length / cols);

  return (
    <div ref={containerRef} className="label-print-area relative" style={{ marginLeft: "15mm", marginTop: "10mm" }}>
      {/* Grid of labels */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 40mm)`,
          gap: "10px",
        }}
      >
        {parts.map((part) => (
          <div
            key={part.id}
            className="flex items-center gap-1 bg-white overflow-hidden print:bg-white"
            style={{
              width: "40mm",
              height: "12mm",
              padding: "0.5mm 1mm",
            }}
          >
            <canvas
              data-qr={part.barcode || `${part.item_code}`}
              className="shrink-0"
              style={{ width: "9mm", height: "9mm" }}
            />
            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden">
              <div
                className="font-semibold text-black leading-none truncate"
                style={{ fontSize: "6pt" }}
              >
                {part.item_name}
              </div>
              <div
                className="text-gray-600 leading-none truncate font-mono"
                style={{ fontSize: "5pt", marginTop: "0.5px" }}
              >
                {part.barcode || part.item_code}
                {part.package && ` · ${part.package}`}
              </div>
              {part.location && (
                <div
                  className="text-gray-500 leading-none truncate"
                  style={{ fontSize: "4.5pt", marginTop: "0.5px" }}
                >
                  {part.location}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Vertical cut lines — before first column, between columns, after last column */}
      {Array.from({ length: cols + 1 }, (_, i) => (
        <div
          key={`v-${i}`}
          className="absolute top-0 bottom-0 border-l border-dashed border-gray-400 print:border-gray-500"
          style={{
            left: i === 0
              ? "-5px"
              : i <= cols - 1
              ? `calc(${i} * 40mm + ${i - 1} * 10px + 5px)`
              : `calc(${cols} * 40mm + ${cols - 1} * 10px + 5px)`,
          }}
        />
      ))}

      {/* Horizontal cut lines — before first row, between rows, after last row */}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <div
          key={`h-${i}`}
          className="absolute left-0 right-0 border-t border-dashed border-gray-400 print:border-gray-500"
          style={{
            top: i === 0
              ? "-5px"
              : i <= rows - 1
              ? `calc(${i} * 12mm + ${i - 1} * 10px + 5px)`
              : `calc(${rows} * 12mm + ${rows - 1} * 10px + 5px)`,
          }}
        />
      ))}
    </div>
  );
}
