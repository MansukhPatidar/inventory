"use client";

import { useEffect, useRef, useState } from "react";

export function QrScanner({
  onScan,
}: {
  onScan: (barcode: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<import("html5-qrcode").Html5Qrcode | null>(null);
  const stoppedRef = useRef(false);
  const scannerDivRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stoppedRef.current = false;
    const scannerDiv = scannerDivRef.current;

    async function init() {
      if (!scannerDiv) return;

      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (stoppedRef.current) return;

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        id={"qr-reader-" + "static"}
        ref={scannerDivRef}
        style={{ width: "100%", minHeight: 300 }}
      />
      {error && (
        <div className="p-4 text-sm text-amber-400 bg-amber-400/10 rounded-lg m-4">
          {error}
        </div>
      )}
    </div>
  );
}
