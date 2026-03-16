"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { read, utils } from "xlsx";
import { importParts } from "@/lib/actions";

interface PreviewRow {
  barcode?: string;
  item_code: number;
  item_name: string;
  package?: string;
  location?: string;
  details?: string;
  qty?: number;
}

export default function ImportPage() {
  const router = useRouter();
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    try {
      const data = await file.arrayBuffer();
      const wb = read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = utils.sheet_to_json<Record<string, unknown>>(ws);

      const parsed: PreviewRow[] = json
        .map((row) => {
          const barcode =
            row["Barcode"] ?? row["barcode"];
          const itemCode =
            row["Item Code"] ?? row["item_code"] ?? row["Code"] ?? row["#"];
          const itemName =
            row["Item Name"] ?? row["item_name"] ?? row["Name"] ?? row["Part"];
          const pkg = row["Package"] ?? row["package"] ?? row["Pkg"];
          const location =
            row["Location"] ?? row["location"] ?? row["Box"] ?? row["box_id"];
          const details =
            row["Details"] ?? row["details"] ?? row["Description"] ?? row["Desc"];
          const qty =
            row["Qty Available"] ?? row["Qty"] ?? row["qty"] ?? row["Quantity"] ?? row["Count"];

          return {
            barcode: barcode ? String(barcode) : undefined,
            item_code: parseInt(String(itemCode)) || 0,
            item_name: String(itemName || ""),
            package: pkg ? String(pkg) : undefined,
            location: location ? String(location) : undefined,
            details: details ? String(details) : undefined,
            qty: qty ? parseInt(String(qty)) || 0 : 0,
          };
        })
        .filter((r) => r.item_code > 0 && r.item_name);

      setRows(parsed);
    } catch (err) {
      setError("Failed to parse file: " + (err as Error).message);
    }
  }

  async function handleImport() {
    setImporting(true);
    try {
      await importParts(rows);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError("Import failed: " + (err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload an .xlsx file with columns: Barcode, Item Code, Item Name, Package, Location, Details, Qty Available
        </p>
      </div>

      <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/50 hover:border-primary/50 bg-card p-8 cursor-pointer transition-colors">
        <div className="text-4xl mb-2 opacity-40">+</div>
        <span className="text-sm text-muted-foreground">
          Choose .xlsx, .xls, or .csv file
        </span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          className="hidden"
        />
      </label>

      {error && (
        <p className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg">{error}</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="overflow-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="bg-secondary sticky top-0">
                  <tr>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Barcode
                    </th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      #
                    </th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Name
                    </th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Pkg
                    </th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Location
                    </th>
                    <th className="text-left p-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Qty
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-t border-border/30 hover:bg-accent/50">
                      <td className="p-3 font-mono text-muted-foreground">{row.barcode}</td>
                      <td className="p-3 font-mono text-muted-foreground">{row.item_code}</td>
                      <td className="p-3">{row.item_name}</td>
                      <td className="p-3 font-mono text-muted-foreground">{row.package}</td>
                      <td className="p-3 font-mono text-primary">{row.location}</td>
                      <td className="p-3 font-mono">{row.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleImport} disabled={importing} size="lg">
              {importing ? "Importing..." : `Import ${rows.length} parts`}
            </Button>
            <Button variant="ghost" onClick={() => setRows([])}>
              Clear
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
