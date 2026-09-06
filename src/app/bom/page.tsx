"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { UploadCloud, ChevronDown, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getParts } from "@/lib/actions";
import { decodeBomBuffer, parseBomFull } from "@/lib/bom-parse";
import { reconcile } from "@/lib/bom-match";
import type { Part } from "@/lib/types";
import type { BomLine } from "@/lib/bom-parse";
import type { Candidate, MatchStatus, ReconciledLine } from "@/lib/bom-match";

/** Session-only override: row index -> chosen candidate index. Never written to Supabase. */
type Overrides = Record<number, number>;

export default function BomPageWrapper() {
  return (
    <Suspense fallback={<BomSkeleton />}>
      <BomPage />
    </Suspense>
  );
}

function BomSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 rounded-lg bg-card animate-pulse" />
      <div className="h-24 rounded-xl bg-card animate-pulse" />
      <div className="h-64 rounded-xl bg-card animate-pulse" />
    </div>
  );
}

function BomPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [loadingParts, setLoadingParts] = useState(true);

  const [bomStatus, setBomStatus] = useState<string | null>(null);
  const [lines, setLines] = useState<BomLine[]>([]);
  const [results, setResults] = useState<ReconciledLine[]>([]);
  const [overrides, setOverrides] = useState<Overrides>({});

  const [inputTab, setInputTab] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const [statusFilter, setStatusFilter] = useState<MatchStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getParts();
        if (!cancelled) setParts(data);
      } catch {
        toast.error("Failed to load parts from inventory");
      } finally {
        if (!cancelled) setLoadingParts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runReconciliation = useCallback(
    (bomLines: BomLine[], inventoryParts: Part[]) => {
      setResults(reconcile(bomLines, inventoryParts));
      setOverrides({});
      setExpandedIdx(null);
    },
    []
  );

  // Re-run whenever parts finish loading after a BOM was already parsed.
  useEffect(() => {
    if (lines.length > 0 && !loadingParts) {
      runReconciliation(lines, parts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingParts]);

  function loadBomFromText(text: string, filename: string | null) {
    const parsed = parseBomFull(text);
    if (parsed.rows.length === 0) {
      setBomStatus("Could not find any data rows in the supplied text.");
      toast.error("No BOM rows found");
      return;
    }
    setLines(parsed.rows);
    const mappedCols = Object.keys(parsed.colMap).length;
    setBomStatus(
      `${filename ? filename + ": " : ""}${parsed.rows.length} line(s) loaded, ${mappedCols}/9 known columns recognized.`
    );
    runReconciliation(parsed.rows, parts);
  }

  function handleBomFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buf = e.target?.result;
      if (!(buf instanceof ArrayBuffer)) return;
      const text = decodeBomBuffer(buf);
      loadBomFromText(text, file.name);
    };
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsArrayBuffer(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleBomFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleBomFile(file);
  }

  function handlePasteSubmit() {
    if (!pasteText.trim()) {
      toast.error("Paste area is empty");
      return;
    }
    loadBomFromText(pasteText, null);
  }

  function effectiveMatch(idx: number, result: ReconciledLine): Candidate | null {
    const overrideIdx = overrides[idx];
    if (overrideIdx !== undefined && result.candidates[overrideIdx]) {
      return result.candidates[overrideIdx];
    }
    return result.candidates.length > 0 ? result.candidates[0] : null;
  }

  function effectiveStatus(idx: number, result: ReconciledLine): MatchStatus {
    const overrideIdx = overrides[idx];
    if (overrideIdx !== undefined && result.candidates[overrideIdx]) {
      const tier = result.candidates[overrideIdx].tier;
      return tier === "mpn" || tier === "supplier" || tier === "value+package"
        ? "green"
        : "amber";
    }
    return result.status;
  }

  const counts = useMemo(() => {
    const c = { green: 0, amber: 0, red: 0 };
    results.forEach((r, idx) => {
      c[effectiveStatus(idx, r)]++;
    });
    const distinct = new Set(
      results.map((r) => `${r.line.mpn || r.line.comment || ""}|${r.line.footprint || ""}`)
    );
    return { ...c, total: results.length, distinct: distinct.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, overrides]);

  const visibleIndices = useMemo(() => {
    const term = search.trim().toLowerCase();
    return results
      .map((_, idx) => idx)
      .filter((idx) => {
        const r = results[idx];
        const st = effectiveStatus(idx, r);
        if (statusFilter !== "all" && st !== statusFilter) return false;
        if (!term) return true;
        const row = r.line;
        const haystack = [row.comment, row.designator, row.footprint, row.value, row.mpn, row.supplierPart]
          .join(" ")
          .toLowerCase();
        if (haystack.includes(term)) return true;
        const m = effectiveMatch(idx, r);
        if (m) {
          const invHay = `${m.part.item_name} ${m.part.details || ""} ${m.part.location || ""}`.toLowerCase();
          if (invHay.includes(term)) return true;
        }
        return false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, overrides, statusFilter, search]);

  function exportCsv() {
    const headers = [
      "Status",
      "Designators",
      "Comment",
      "Value",
      "Footprint",
      "BOM Qty",
      "Matched Item",
      "Location",
      "Bin",
      "Inv Qty",
      "Tier",
      "Score",
      "Overridden",
    ];
    const csvEscape = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = results.map((r, idx) => {
      const row = r.line;
      const st = effectiveStatus(idx, r);
      const m = effectiveMatch(idx, r);
      return [
        st,
        row.designator,
        row.comment,
        row.value,
        row.footprint,
        row.quantity,
        m ? m.part.item_name : "",
        m ? m.part.location : "",
        m ? m.part.bin_number : "",
        m ? m.part.qty : "",
        m ? m.tier : "",
        m ? m.score.toFixed(2) : "",
        overrides[idx] !== undefined ? "yes" : "no",
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bom_reconciliation.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported CSV");
  }

  return (
    <div className="space-y-5 xl:w-[min(1400px,90vw)] xl:max-w-none xl:-mx-[calc((min(1400px,90vw)-42rem)/2)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">BOM Reconciler</h1>
        <p className="text-sm text-muted-foreground">
          {loadingParts ? "Loading inventory..." : `${parts.length} parts in inventory`}
        </p>
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <div className="flex gap-1 border-b border-border/50">
          <TabButton active={inputTab === "file"} onClick={() => setInputTab("file")}>
            File
          </TabButton>
          <TabButton active={inputTab === "paste"} onClick={() => setInputTab("paste")}>
            Paste text
          </TabButton>
        </div>

        {inputTab === "file" ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragActive(false);
            }}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
              dragActive
                ? "border-primary bg-primary/5 text-primary"
                : "border-border/50 hover:border-primary/50 text-muted-foreground"
            }`}
          >
            <UploadCloud size={28} className="opacity-60" />
            <span className="text-sm">
              <strong className="text-foreground">Click to choose</strong> or drag a BOM file here
            </span>
            <span className="text-xs text-muted-foreground/60">CSV or TSV, UTF-8 or UTF-16</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste BOM text (tab- or comma-separated, with a header row)..."
              rows={6}
              className="bg-secondary border-border/50 font-mono text-xs"
            />
            <Button size="sm" onClick={handlePasteSubmit}>
              Parse pasted text
            </Button>
          </div>
        )}

        {bomStatus && <p className="text-xs text-muted-foreground/70 italic">{bomStatus}</p>}
      </div>

      {results.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            <CounterPill label="Total" value={counts.total} tone="default" />
            <CounterPill label="Green" value={counts.green} tone="green" />
            <CounterPill label="Amber" value={counts.amber} tone="amber" />
            <CounterPill label="Red" value={counts.red} tone="red" />
            <CounterPill label="Distinct" value={counts.distinct} tone="default" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
              All
            </FilterButton>
            <FilterButton active={statusFilter === "green"} onClick={() => setStatusFilter("green")}>
              Green
            </FilterButton>
            <FilterButton active={statusFilter === "amber"} onClick={() => setStatusFilter("amber")}>
              Amber
            </FilterButton>
            <FilterButton active={statusFilter === "red"} onClick={() => setStatusFilter("red")}>
              Red
            </FilterButton>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lines or matches..."
              className="h-8 max-w-xs bg-secondary border-border/50"
            />
            <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={exportCsv}>
              <Download size={14} /> Export CSV
            </Button>
          </div>

          <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead className="bg-secondary">
                  <tr>
                    <Th></Th>
                    <Th>Status</Th>
                    <Th>Designators</Th>
                    <Th>Comment / Value</Th>
                    <Th>Footprint</Th>
                    <Th>BOM Qty</Th>
                    <Th>Matched Part</Th>
                    <Th>Location</Th>
                    <Th>Inv Qty</Th>
                    <Th>Tier</Th>
                    <Th>Score</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIndices.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="text-center text-muted-foreground p-8">
                        No rows match the current filter/search.
                      </td>
                    </tr>
                  ) : (
                    visibleIndices.map((idx) => {
                      const r = results[idx];
                      const st = effectiveStatus(idx, r);
                      const m = effectiveMatch(idx, r);
                      const isExpanded = expandedIdx === idx;
                      const isOverridden = overrides[idx] !== undefined;
                      return (
                        <RowGroup
                          key={idx}
                          result={r}
                          status={st}
                          match={m}
                          isExpanded={isExpanded}
                          isOverridden={isOverridden}
                          onToggle={() => setExpandedIdx(isExpanded ? null : idx)}
                          onPick={(candIdx) => {
                            setOverrides((prev) => ({ ...prev, [idx]: candIdx }));
                          }}
                          onClearOverride={() => {
                            setOverrides((prev) => {
                              const next = { ...prev };
                              delete next[idx];
                              return next;
                            });
                          }}
                        />
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TabButton({
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
      className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FilterButton({
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
      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
        active
          ? "border-primary text-primary bg-primary/10"
          : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function CounterPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "green" | "amber" | "red";
}) {
  const toneClasses: Record<string, string> = {
    default: "border-border/50 text-primary",
    green: "border-green-500/30 text-green-400",
    amber: "border-amber-500/30 text-amber-400",
    red: "border-red-500/30 text-red-400",
  };
  return (
    <div className={`rounded-lg border bg-secondary/50 px-3.5 py-1.5 text-center min-w-[76px] ${toneClasses[tone]}`}>
      <div className="text-lg font-bold font-mono leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: MatchStatus }) {
  const classes: Record<MatchStatus, string> = {
    green: "bg-green-500/15 text-green-400 border-green-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    red: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${classes[status]}`}
    >
      {status}
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left p-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
      {children}
    </th>
  );
}

function RowGroup({
  result,
  status,
  match,
  isExpanded,
  isOverridden,
  onToggle,
  onPick,
  onClearOverride,
}: {
  result: ReconciledLine;
  status: MatchStatus;
  match: Candidate | null;
  isExpanded: boolean;
  isOverridden: boolean;
  onToggle: () => void;
  onPick: (candIdx: number) => void;
  onClearOverride: () => void;
}) {
  const row = result.line;
  const designatorFull = row.designator;
  const designatorTruncated =
    designatorFull.length > 28 ? designatorFull.slice(0, 26) + "…" : designatorFull;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-t border-border/30 cursor-pointer hover:bg-accent/50 ${
          isExpanded ? "bg-accent/40" : ""
        }`}
      >
        <td className="p-2.5 text-muted-foreground w-6">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="p-2.5">
          <StatusPill status={status} />
        </td>
        <td className="p-2.5 font-mono text-xs max-w-[220px] truncate" title={designatorFull}>
          {designatorTruncated}
        </td>
        <td className="p-2.5">
          {row.comment}
          {row.value && row.value !== row.comment && (
            <span className="text-muted-foreground"> ({row.value})</span>
          )}
        </td>
        <td className="p-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
          {row.footprint}
        </td>
        <td className="p-2.5 font-mono text-xs">{row.quantity}</td>
        <td className="p-2.5">
          {match ? (
            <Link
              href={`/parts?id=${match.part.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:underline"
            >
              {match.part.item_name}
            </Link>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
          {isOverridden && (
            <Badge variant="outline" className="ml-1.5 text-[9px] border-primary/40 text-primary">
              override
            </Badge>
          )}
        </td>
        <td className="p-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
          {match ? `${match.part.location}${match.part.bin_number ? " / bin " + match.part.bin_number : ""}` : "—"}
        </td>
        <td className="p-2.5 font-mono text-xs">{match ? match.part.qty : "—"}</td>
        <td className="p-2.5 text-[10px] uppercase text-muted-foreground/70 font-mono whitespace-nowrap">
          {match ? match.tier : "—"}
        </td>
        <td className="p-2.5 font-mono text-xs text-muted-foreground">
          {match ? match.score.toFixed(2) : "—"}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-secondary/40 border-t border-border/30">
          <td colSpan={11} className="p-3">
            {result.candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No candidate matches found in inventory for this line.
              </p>
            ) : (
              <div className="space-y-1.5">
                {isOverridden && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearOverride();
                    }}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear override (use top match)
                  </button>
                )}
                {result.candidates.map((c, ci) => {
                  const picked = isOverridden ? false : ci === 0;
                  return (
                    <div
                      key={ci}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${
                        picked
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/40 bg-card"
                      }`}
                    >
                      <span className="text-muted-foreground w-4 shrink-0">{ci + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.part.item_name}</div>
                        {c.part.details && (
                          <div className="text-muted-foreground/70 truncate">{c.part.details}</div>
                        )}
                      </div>
                      <div className="font-mono text-muted-foreground whitespace-nowrap">
                        {c.part.location}
                        {c.part.bin_number ? ` / bin ${c.part.bin_number}` : ""}
                      </div>
                      <div className="font-mono whitespace-nowrap w-16 shrink-0">
                        {c.part.package || "—"}
                      </div>
                      <div className="font-mono whitespace-nowrap w-14 shrink-0">qty {c.part.qty ?? "—"}</div>
                      <div className="uppercase text-[10px] text-muted-foreground/70 font-mono whitespace-nowrap w-24 shrink-0">
                        {c.tier} <span className="text-muted-foreground">{c.score.toFixed(2)}</span>
                      </div>
                      <div className="w-20 shrink-0 text-right">
                        {picked ? (
                          <span className="text-muted-foreground/60 text-[11px]">selected</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPick(ci);
                            }}
                          >
                            Use this
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
