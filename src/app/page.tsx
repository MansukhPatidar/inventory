"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
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

  // Sync state to URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (selectedLocation) params.set("loc", selectedLocation);
    const str = params.toString();
    const newUrl = str ? `?${str}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
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

      <LocationFilter
        locations={locations}
        selected={selectedLocation}
        onSelect={setSelectedLocation}
      />

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card animate-pulse" />
          ))}
        </div>
      ) : parts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No parts found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Try a different search or import your spreadsheet
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {parts.map((part) => (
            <PartCard key={part.id} part={part} onDeleted={fetchParts} />
          ))}
        </div>
      )}
    </div>
  );
}
