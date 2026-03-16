"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/qr-scanner";
import { getPartByBarcode } from "@/lib/actions";

export default function ScanPage() {
  const router = useRouter();
  const [status, setStatus] = useState<string>("Point camera at a QR code");
  const [scanning, setScanning] = useState(true);

  async function handleScan(barcode: string) {
    setScanning(false);
    setStatus(`Scanned: ${barcode}`);

    const part = await getPartByBarcode(barcode);
    if (part) {
      router.push(`/parts/${part.id}`);
    } else {
      setStatus(`No part found for "${barcode}"`);
      setTimeout(() => {
        setScanning(true);
        setStatus("Point camera at a QR code");
      }, 2000);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scan QR</h1>
        <p className="text-sm text-muted-foreground mt-1">Scan a bin label to find a part</p>
      </div>
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        {scanning && <QrScanner onScan={handleScan} />}
      </div>
      <p className="text-sm text-muted-foreground text-center font-mono">{status}</p>
    </div>
  );
}
