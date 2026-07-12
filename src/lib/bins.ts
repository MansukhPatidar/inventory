export type BinnedPart = {
  location: string | null;
  bin_number: number | null;
};

export type AssignablePart = BinnedPart & {
  id: number;
  item_code: number;
};

/** The printed physical address of a part, e.g. "B9-1". */
export function formatAddress(location: string, binNumber: number): string {
  return `${location}-${binNumber}`;
}

/**
 * A bin the box cannot name — past its compartment count, or below 1. Legal to
 * store (the grid flags it rather than blocking it), but callers rely on this
 * to mean "do not index a slot array with it".
 */
export function isOutOfRange(binNumber: number, binCount: number): boolean {
  return binNumber > binCount || binNumber < 1;
}

/** Every part sharing a given bin. Bins are shareable by design. */
export function binOccupants<T extends BinnedPart>(
  parts: T[],
  location: string,
  binNumber: number
): T[] {
  return parts.filter(
    (p) => p.location === location && p.bin_number === binNumber
  );
}

/** The lowest bin number in a box that no part occupies. Fills gaps. */
export function nextFreeBin(parts: BinnedPart[], location: string): number {
  const taken = new Set(
    parts
      .filter((p) => p.location === location && p.bin_number != null)
      .map((p) => p.bin_number as number)
  );
  let bin = 1;
  while (taken.has(bin)) bin++;
  return bin;
}

/**
 * Sentinel occupancy value meaning "we don't yet know what's in this box" —
 * distinct from an empty array, which means "we checked, and it's empty."
 * Callers MUST refuse to allocate when occupancy is this value. Conflating
 * the two (e.g. via `cache[location] ?? []`) is what lets auto-allocation
 * silently hand out bin 1 on top of an existing occupant while the real
 * occupancy fetch is still in flight.
 */
export const OCCUPANCY_UNKNOWN = "unknown" as const;

export type BoxOccupancy = BinnedPart[] | typeof OCCUPANCY_UNKNOWN;

/**
 * Allocate `count` free bins in `location`, in order, accounting for both
 * already-stored parts and parts already queued (not yet saved) for the same
 * box. Occupancy must be known — pass `OCCUPANCY_UNKNOWN` (never `[]`) when
 * the box's stored parts haven't been fetched yet, and this returns `null`
 * rather than guessing. Bins handed out are always free ones; the caller is
 * still free to let a user type an already-occupied bin explicitly (bins are
 * shareable by design) — this function only governs *auto*-allocation.
 */
export function allocateBins(
  location: string,
  count: number,
  storedOccupancy: BoxOccupancy,
  queued: BinnedPart[]
): number[] | null {
  if (storedOccupancy === OCCUPANCY_UNKNOWN) return null;

  const occupied: BinnedPart[] = [
    ...storedOccupancy,
    ...queued.filter(
      (p) => p.location === location && (p.bin_number ?? 0) > 0
    ),
  ];

  const bins: number[] = [];
  for (let i = 0; i < count; i++) {
    const bin = nextFreeBin(occupied, location);
    bins.push(bin);
    occupied.push({ location, bin_number: bin });
  }
  return bins;
}

/**
 * Backfill bin numbers. Parts with an explicit bin keep it. Parts without one
 * take the lowest free bin in their box, in item_code order. Assignment counts
 * past the box's bin_count rather than failing — an over-capacity bin is a
 * flagged state the user corrects, not an error.
 *
 * Returns a map of part id -> newly assigned bin number. Parts that already had
 * a bin, and parts with no location, are absent from the map.
 *
 * Not called at runtime. This is the executable spec for the one-time backfill
 * performed by migration 20260712000000_bin_addressed_storage.sql, which has
 * already run irreversibly against production data. Kept (and tested) as
 * documentation of that migration's allocation rule — do not assume it is
 * wired into any live code path.
 */
export function assignBins<T extends AssignablePart>(
  parts: T[]
): Map<number, number> {
  const assignments = new Map<number, number>();
  const byBox = new Map<string, T[]>();

  for (const part of parts) {
    if (!part.location) continue;
    const group = byBox.get(part.location);
    if (group) group.push(part);
    else byBox.set(part.location, [part]);
  }

  for (const group of byBox.values()) {
    const taken = new Set(
      group
        .filter((p) => p.bin_number != null)
        .map((p) => p.bin_number as number)
    );

    const unbinned = group
      .filter((p) => p.bin_number == null)
      .sort((a, b) => a.item_code - b.item_code);

    let bin = 1;
    for (const part of unbinned) {
      while (taken.has(bin)) bin++;
      assignments.set(part.id, bin);
      taken.add(bin);
      bin++;
    }
  }

  return assignments;
}
