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

/** A bin past the box's physical compartment count. Legal, but flagged. */
export function isOutOfRange(binNumber: number, binCount: number): boolean {
  return binNumber > binCount;
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
 * Backfill bin numbers. Parts with an explicit bin keep it. Parts without one
 * take the lowest free bin in their box, in item_code order. Assignment counts
 * past the box's bin_count rather than failing — an over-capacity bin is a
 * flagged state the user corrects, not an error.
 *
 * Returns a map of part id -> newly assigned bin number. Parts that already had
 * a bin, and parts with no location, are absent from the map.
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
