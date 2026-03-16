"use client";

import { useEffect, useRef, useState } from "react";

export function QrScanner({
  onScan,
}: {
  onScan: (barcode: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    let scannerDiv: HTMLDivElement | null = null;

    async function init() {
      if (!containerRef.current) return;

      // Create a fresh div for the scanner outside React's control
      scannerDiv = document.createElement("div");
      scannerDiv.id = "qr-reader-" + Date.now();
      containerRef.current.appendChild(scannerDiv);

      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (stoppedRef.current) {
          scannerDiv.remove();
          return;
        }

        const scanner = new Html5Qrcode(scannerDiv.id);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (!stoppedRef.current) {
              onScan(decodedText);
            }
            scanner.stop().catch(() => {});
          },
          () => {}
        );
        if (!stoppedRef.current) setReady(true);
      } catch {
        if (!stoppedRef.current) {
          setError(
            "Could not access camera. Allow camera permissions and ensure HTTPS or localhost."
          );
        }
      }
    }

    init();

    return () => {
      stoppedRef.current = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner.stop().catch(() => {});
        scannerRef.current = null;
      }
      // Clean up the DOM element we created
      if (scannerDiv && scannerDiv.parentNode) {
        scannerDiv.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className={`w-full overflow-hidden ${ready ? "" : "min-h-[300px] flex items-center justify-center"}`}
      >
        {!ready && !error && (
          <p className="text-sm text-muted-foreground animate-pulse">
            Starting camera...
          </p>
        )}
      </div>
      {error && (
        <div className="p-4 text-sm text-amber-400 bg-amber-400/10 rounded-lg m-4">
          {error}
        </div>
      )}
    </div>
  );
}
