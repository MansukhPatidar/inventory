"use client";

import { useEffect, useRef, useMemo } from "react";
import QRCode from "qrcode";
import type { Box } from "@/lib/types";

// Box label: 60mm wide × 30mm tall, 2 copies each

export function BoxLabelGrid({ boxes }: { boxes: Box[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Duplicate each box for 2 copies
  const labels = useMemo(
    () => boxes.flatMap((box) => [box, box]),
    [boxes]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const canvases = containerRef.current.querySelectorAll("canvas[data-qr]");
    canvases.forEach((canvas) => {
      const code = canvas.getAttribute("data-qr");
      if (code) {
        QRCode.toCanvas(canvas as HTMLCanvasElement, code, {
          width: 80,
          margin: 0,
          color: { dark: "#000000", light: "#ffffff" },
        });
      }
    });
  }, [labels]);

  const cols = useMemo(() => {
    if (typeof window === "undefined") return 3;
    return Math.max(1, Math.floor((600 + 10) / (227 + 10)));
  }, []);

  const rows = Math.ceil(labels.length / cols);

  return (
    <div
      ref={containerRef}
      className="label-print-area relative"
      style={{ marginLeft: "15mm", marginTop: "10mm" }}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 60mm)`,
          gap: "10px",
        }}
      >
        {labels.map((box, i) => (
          <div
            key={`${box.id}-${i}`}
            className="flex flex-col items-center justify-center bg-white overflow-hidden print:bg-white"
            style={{
              width: "60mm",
              height: "30mm",
              padding: "2mm",
            }}
          >
            <canvas
              data-qr={box.id}
              className="shrink-0"
              style={{ width: "18mm", height: "18mm" }}
            />
            <div
              className="font-bold text-black leading-none text-center mt-1"
              style={{ fontSize: "11pt" }}
            >
              {box.id}
            </div>
          </div>
        ))}
      </div>

      {/* Vertical cut lines */}
      {Array.from({ length: cols + 1 }, (_, i) => (
        <div
          key={`v-${i}`}
          className="absolute top-0 bottom-0 border-l border-dashed border-gray-400 print:border-gray-500"
          style={{
            left:
              i === 0
                ? "-5px"
                : i <= cols - 1
                ? `calc(${i} * 60mm + ${i - 1} * 10px + 5px)`
                : `calc(${cols} * 60mm + ${cols - 1} * 10px + 5px)`,
          }}
        />
      ))}

      {/* Horizontal cut lines */}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <div
          key={`h-${i}`}
          className="absolute left-0 right-0 border-t border-dashed border-gray-400 print:border-gray-500"
          style={{
            top:
              i === 0
                ? "-5px"
                : i <= rows - 1
                ? `calc(${i} * 30mm + ${i - 1} * 10px + 5px)`
                : `calc(${rows} * 30mm + ${rows - 1} * 10px + 5px)`,
          }}
        />
      ))}
    </div>
  );
}
