"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { LocationFilter } from "@/components/box-filter";
import { PartCard } from "@/components/part-card";
import { getParts, getLocations } from "@/lib/actions";
import type { Part } from "@/lib/types";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-card animate-pulse" />)}</div>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [parts, setParts] = useState<Part[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [selectedLocation, setSelectedLocation] = useState<string | null>(
    searchParams.get("loc") ?? null
  );
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"id" | "name">("id");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Sync state to URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (selectedLocation) params.set("loc", selectedLocation);
    const str = params.toString();
    const newUrl = str ? `?${str}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [search, selectedLocation]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [search, selectedLocation]);

  const fetchParts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getParts(search || undefined, selectedLocation || undefined);
      setParts(data);
    } catch {
      console.error("Failed to fetch parts");
    } finally {
      setLoading(false);
    }
  }, [search, selectedLocation]);

  useEffect(() => {
    getLocations().then(setLocations);
  }, []);

  useEffect(() => {
    const timer = setTimeout(fetchParts, 300);
    return () => clearTimeout(timer);
  }, [fetchParts]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading..." : `${parts.length} parts`}
        </p>
      </div>

      <div className="relative">
        <Input
          placeholder="Search parts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-base h-11 bg-card border-border/50 focus-visible:border-primary pr-9"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <LocationFilter
          locations={locations}
          selected={selectedLocation}
          onSelect={setSelectedLocation}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "id" | "name")}
          className="shrink-0 text-xs bg-secondary border border-border/50 rounded-lg px-2 py-1.5 text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="id">Sort: ID</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {(() => {
        if (loading) {
          return (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-card animate-pulse" />
              ))}
            </div>
          );
        }
        if (parts.length === 0) {
          return (
            <div className="text-center py-16">
              <p className="text-muted-foreground">No parts found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Try a different search or import your spreadsheet
              </p>
            </div>
          );
        }

        const sorted = [...parts].sort((a, b) =>
          sortBy === "name"
            ? a.item_name.localeCompare(b.item_name)
            : a.item_code - b.item_code
        );
        const totalPages = Math.ceil(sorted.length / pageSize);
        const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

        return (
          <>
            <div className="space-y-2">
              {paged.map((part) => (
                <PartCard key={part.id} part={part} allParts={parts} onDeleted={fetchParts} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2 py-1.5 text-xs rounded-lg bg-secondary border border-border/50 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Prev
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2 py-1.5 text-xs rounded-lg bg-secondary border border-border/50 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
