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
    router.replace(str ? `/?${str}` : "/", { scroll: false });
  }, [search, selectedLocation, router]);

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

      <Input
        placeholder="Search parts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="text-base h-11 bg-card border-border/50 focus-visible:border-primary"
      />

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
