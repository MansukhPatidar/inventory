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
import { reconcile, findRelaxedCandidates } from "@/lib/bom-match";
import { formatAddress } from "@/lib/bins";
import type { Part } from "@/lib/types";
import type { BomLine } from "@/lib/bom-parse";
import type {
  Candidate,
  MatchStatus,
  ReconciledLine,
  RelaxedCandidate,
  RelaxedReason,
} from "@/lib/bom-match";

/** Session-only override: row index -> chosen candidate index. Never written to Supabase. */
type Overrides = Record<number, number>;

/**
 * Session-only per-line triage decision for red lines. Never written to
 * Supabase, never persisted to localStorage — this is explicitly a
 * this-session-only workflow aid; reloading the page or re-parsing the BOM
 * resets it.
 */
type Decision =
  | { kind: "undecided" }
  | { kind: "order" }
  | { kind: "substitute"; part: Part };

type Decisions = Record<number, Decision>;

const UNDECIDED: Decision = { kind: "undecided" };

const RELAXED_REASON_LABEL: Record<RelaxedReason, string> = {
  "exact-value-other-package": "same value, different package",
  "near-value-same-package": "close value, same package",
  "near-value-other-package": "close value, different package",
};

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
  const [decisions, setDecisions] = useState<Decisions>({});

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
      setDecisions({});
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

  function decisionFor(idx: number): Decision {
    return decisions[idx] ?? UNDECIDED;
  }

  const relaxedByIdx = useMemo(() => {
    const map = new Map<number, RelaxedCandidate[]>();
    results.forEach((r, idx) => {
      if (r.status === "red") map.set(idx, findRelaxedCandidates(r, parts));
    });
    return map;
  }, [results, parts]);

  const counts = useMemo(() => {
    const c = { green: 0, amber: 0, red: 0 };
    let redUndecided = 0;
    let redOrder = 0;
    let redSubstitute = 0;
    results.forEach((r, idx) => {
      const st = effectiveStatus(idx, r);
      c[st]++;
      if (st === "red") {
        const d = decisionFor(idx);
        if (d.kind === "order") redOrder++;
        else if (d.kind === "substitute") redSubstitute++;
        else redUndecided++;
      }
    });
    const distinct = new Set(
      results.map((r) => `${r.line.mpn || r.line.comment || ""}|${r.line.footprint || ""}`)
    );
    return {
      ...c,
      total: results.length,
      distinct: distinct.size,
      redUndecided,
      redOrder,
      redSubstitute,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, overrides, decisions]);

  const { visible: visibleIndices, searchOnlyCount } = useMemo(() => {
    // Whitespace-separated keywords, all of which must appear somewhere in
    // the row. Terms are ANDed and each may match a different field, so
    // "0603 100n" finds the 100nF in an 0603 package, and "b10 22uf" finds
    // the 22uF that lives in box B10. A quoted "..." group is kept intact
    // for phrases that contain a space.
    const terms = (search.toLowerCase().match(/"[^"]+"|\S+/g) || [])
      .map((t) => t.replace(/^"|"$/g, "").trim())
      .filter(Boolean);

    const matchesSearch = (idx: number) => {
      if (terms.length === 0) return true;
      // One combined haystack over BOM fields and the matched inventory
      // part, so a keyword hitting either side counts.
      const r = results[idx];
      const row = r.line;
      const m = effectiveMatch(idx, r);
      const haystack = [
        row.comment,
        row.designator,
        row.footprint,
        row.value,
        row.mpn,
        row.supplierPart,
        m?.part.item_name,
        m?.part.details,
        m?.part.location,
        m?.part.package,
        m ? `bin ${m.part.bin_number}` : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    };

    const all = results.map((_, idx) => idx);
    // Tracked separately so the empty state can distinguish "this search
    // found nothing" from "the status filter is hiding your results",
    // which is otherwise a silent dead end.
    const searchOnly = all.filter(matchesSearch);
    const visible = searchOnly.filter((idx) => {
      if (statusFilter === "all") return true;
      return effectiveStatus(idx, results[idx]) === statusFilter;
    });
    return { visible, searchOnlyCount: searchOnly.length };
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
      "Decision",
      "Substitute Part",
      "Substitute Location",
      "Substitute Bin",
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
      const d = decisionFor(idx);
      const decisionLabel =
        st !== "red" ? "" : d.kind === "order" ? "order" : d.kind === "substitute" ? "substitute" : "undecided";
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
        decisionLabel,
        d.kind === "substitute" ? d.part.item_name : "",
        d.kind === "substitute" ? d.part.location : "",
        d.kind === "substitute" ? d.part.bin_number : "",
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
            {counts.red > 0 && (
              <>
                <CounterPill label="Undecided" value={counts.redUndecided} tone="red" />
                <CounterPill label="To Order" value={counts.redOrder} tone="amber" />
                <CounterPill label="Substituted" value={counts.redSubstitute} tone="green" />
              </>
            )}
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
              placeholder="Search — all keywords must match, e.g. 0603 100n"
              className="h-8 max-w-sm bg-secondary border-border/50"
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
                    <Th>Decision</Th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIndices.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center text-muted-foreground p-8">
                        {searchOnlyCount > 0 ? (
                          <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
                            <span>
                              {searchOnlyCount}{" "}
                              {searchOnlyCount === 1 ? "row matches" : "rows match"} this
                              search, hidden by the {statusFilter} filter.
                            </span>
                            <button
                              type="button"
                              onClick={() => setStatusFilter("all")}
                              className="underline underline-offset-2 text-primary hover:opacity-80"
                            >
                              Show all statuses
                            </button>
                          </span>
                        ) : search.trim() ? (
                          "No rows match this search."
                        ) : (
                          "No rows match the current filter."
                        )}
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
                          decision={decisionFor(idx)}
                          relaxedCandidates={relaxedByIdx.get(idx) ?? []}
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
                          onMarkOrder={() => {
                            setDecisions((prev) => ({ ...prev, [idx]: { kind: "order" } }));
                            toast.success("Marked for ordering");
                          }}
                          onSubstitute={(part) => {
                            setDecisions((prev) => ({ ...prev, [idx]: { kind: "substitute", part } }));
                            toast.success(`Substituting with ${part.item_name}`);
                          }}
                          onClearDecision={() => {
                            setDecisions((prev) => {
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

function DecisionPill({ decision }: { decision: Decision }) {
  if (decision.kind === "order") {
    return (
      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
        order
      </Badge>
    );
  }
  if (decision.kind === "substitute") {
    return (
      <Badge
        variant="outline"
        className="text-[10px] border-green-500/40 text-green-400 max-w-[160px] truncate"
        title={`Substitute: ${decision.part.item_name}`}
      >
        sub: {decision.part.item_name}
      </Badge>
    );
  }
  return <span className="text-muted-foreground/50 text-xs">—</span>;
}

function RowGroup({
  result,
  status,
  match,
  isExpanded,
  isOverridden,
  decision,
  relaxedCandidates,
  onToggle,
  onPick,
  onClearOverride,
  onMarkOrder,
  onSubstitute,
  onClearDecision,
}: {
  result: ReconciledLine;
  status: MatchStatus;
  match: Candidate | null;
  isExpanded: boolean;
  isOverridden: boolean;
  decision: Decision;
  relaxedCandidates: RelaxedCandidate[];
  onToggle: () => void;
  onPick: (candIdx: number) => void;
  onClearOverride: () => void;
  onMarkOrder: () => void;
  onSubstitute: (part: Part) => void;
  onClearDecision: () => void;
}) {
  const row = result.line;
  const designatorFull = row.designator;
  const designatorTruncated =
    designatorFull.length > 28 ? designatorFull.slice(0, 26) + "…" : designatorFull;
  const isRed = status === "red";

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
        <td className="p-2.5">{isRed ? <DecisionPill decision={decision} /> : <span className="text-muted-foreground/30 text-xs">—</span>}</td>
      </tr>
      {isExpanded && (
        <tr className="bg-secondary/40 border-t border-border/30">
          <td colSpan={12} className="p-3">
            {isRed ? (
              <RedLinePanel
                relaxedCandidates={relaxedCandidates}
                decision={decision}
                onMarkOrder={onMarkOrder}
                onSubstitute={onSubstitute}
                onClearDecision={onClearDecision}
                bomQty={row.quantity}
              />
            ) : result.candidates.length === 0 ? (
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

function RedLinePanel({
  relaxedCandidates,
  decision,
  onMarkOrder,
  onSubstitute,
  onClearDecision,
  bomQty,
}: {
  relaxedCandidates: RelaxedCandidate[];
  decision: Decision;
  onMarkOrder: () => void;
  onSubstitute: (part: Part) => void;
  onClearDecision: () => void;
  bomQty: string;
}) {
  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      {decision.kind !== "undecided" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Decision: <DecisionPill decision={decision} />
          </span>
          <button
            onClick={onClearDecision}
            className="text-muted-foreground hover:text-foreground underline"
          >
            Clear (back to undecided)
          </button>
        </div>
      )}

      {relaxedCandidates.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No near-miss inventory parts found for this line — nothing looks close enough
          to suggest as a substitute.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-secondary/60">
              <tr>
                <Th>Part</Th>
                <Th>Package</Th>
                <Th>Location</Th>
                <Th>Qty</Th>
                <Th>Reason</Th>
                <Th>Score</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {relaxedCandidates.map((c, ci) => {
                const isChosen =
                  decision.kind === "substitute" && decision.part.id === c.part.id;
                return (
                  <tr key={ci} className={`border-t border-border/30 ${isChosen ? "bg-primary/5" : ""}`}>
                    <td className="p-2 max-w-[240px]">
                      <div className="font-medium truncate">{c.part.item_name}</div>
                      {c.part.details && (
                        <div className="text-muted-foreground/70 truncate">{c.part.details}</div>
                      )}
                    </td>
                    <td className="p-2 font-mono whitespace-nowrap">
                      {c.part.package || "—"}
                      {c.crossFamily && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-[9px] border-amber-500/40 text-amber-400"
                        >
                          different footprint
                        </Badge>
                      )}
                    </td>
                    <td className="p-2 font-mono whitespace-nowrap">
                      {formatAddress(c.part.location, c.part.bin_number)}
                    </td>
                    <td className="p-2 font-mono whitespace-nowrap">{c.part.qty ?? "—"}</td>
                    <td className="p-2 text-muted-foreground whitespace-nowrap">
                      {RELAXED_REASON_LABEL[c.reason]}
                    </td>
                    <td className="p-2 font-mono text-muted-foreground whitespace-nowrap">
                      {c.score.toFixed(2)}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      {isChosen ? (
                        <span className="text-muted-foreground/60">selected</span>
                      ) : (
                        <Button variant="ghost" size="xs" onClick={() => onSubstitute(c.part)}>
                          Use this instead
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant={decision.kind === "order" ? "secondary" : "outline"}
          size="sm"
          onClick={onMarkOrder}
        >
          Mark for ordering{bomQty ? ` (qty ${bomQty})` : ""}
        </Button>
      </div>
    </div>
  );
}
