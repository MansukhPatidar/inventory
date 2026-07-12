import { describe, it, expect } from "vitest";
import {
  formatAddress,
  binOccupants,
  isOutOfRange,
  nextFreeBin,
  assignBins,
  allocateBins,
  OCCUPANCY_UNKNOWN,
} from "./bins";

const part = (
  id: number,
  item_code: number,
  location: string | null,
  bin_number: number | null
) => ({ id, item_code, location, bin_number });

describe("formatAddress", () => {
  it("joins box and bin with a hyphen", () => {
    expect(formatAddress("B9", 1)).toBe("B9-1");
  });
});

describe("isOutOfRange", () => {
  it("is false when the bin fits the box", () => {
    expect(isOutOfRange(30, 30)).toBe(false);
  });

  it("is true when the bin exceeds the box capacity", () => {
    expect(isOutOfRange(31, 30)).toBe(true);
  });

  it("is true below bin 1 — callers use this to guard slot-array indexing", () => {
    expect(isOutOfRange(0, 30)).toBe(true);
    expect(isOutOfRange(-1, 30)).toBe(true);
  });
});

describe("binOccupants", () => {
  const parts = [
    part(1, 100, "B9", 5),
    part(2, 101, "B9", 5),
    part(3, 102, "B9", 6),
    part(4, 103, "B8", 5),
  ];

  it("returns every part sharing the bin", () => {
    expect(binOccupants(parts, "B9", 5).map((p) => p.id)).toEqual([1, 2]);
  });

  it("does not match the same bin number in a different box", () => {
    expect(binOccupants(parts, "B8", 5).map((p) => p.id)).toEqual([4]);
  });

  it("returns an empty array for an empty bin", () => {
    expect(binOccupants(parts, "B9", 7)).toEqual([]);
  });
});

describe("nextFreeBin", () => {
  it("returns 1 for an empty box", () => {
    expect(nextFreeBin([], "B9")).toBe(1);
  });

  it("returns the lowest unoccupied bin, filling gaps", () => {
    const parts = [part(1, 100, "B9", 1), part(2, 101, "B9", 3)];
    expect(nextFreeBin(parts, "B9")).toBe(2);
  });

  it("ignores parts in other boxes", () => {
    const parts = [part(1, 100, "B8", 1), part(2, 101, "B8", 2)];
    expect(nextFreeBin(parts, "B9")).toBe(1);
  });

  it("ignores parts that have no bin yet", () => {
    const parts = [part(1, 100, "B9", 1), part(2, 101, "B9", null)];
    expect(nextFreeBin(parts, "B9")).toBe(2);
  });
});

describe("assignBins", () => {
  it("leaves parts that already have a bin untouched", () => {
    const parts = [part(1, 100, "B9", 7)];
    expect(assignBins(parts).size).toBe(0);
  });

  it("assigns unbinned parts the lowest free bins in item_code order", () => {
    const parts = [
      part(2, 200, "B9", null),
      part(1, 100, "B9", null),
      part(3, 300, "B9", null),
    ];
    const result = assignBins(parts);
    expect(result.get(1)).toBe(1);
    expect(result.get(2)).toBe(2);
    expect(result.get(3)).toBe(3);
  });

  it("skips bins already claimed explicitly", () => {
    const parts = [part(1, 100, "B9", null), part(2, 200, "B9", 1)];
    expect(assignBins(parts).get(1)).toBe(2);
  });

  it("treats a shared explicit bin as claimed once", () => {
    const parts = [
      part(1, 100, "B9", 1),
      part(2, 200, "B9", 1),
      part(3, 300, "B9", null),
    ];
    expect(assignBins(parts).get(3)).toBe(2);
  });

  it("assigns bins per box independently", () => {
    const parts = [part(1, 100, "B9", null), part(2, 200, "B8", null)];
    const result = assignBins(parts);
    expect(result.get(1)).toBe(1);
    expect(result.get(2)).toBe(1);
  });

  it("counts past the explicit bins rather than failing", () => {
    const parts = [
      part(1, 100, "B9", 1),
      part(2, 200, "B9", 2),
      part(3, 300, "B9", null),
      part(4, 400, "B9", null),
    ];
    const result = assignBins(parts);
    expect(result.get(3)).toBe(3);
    expect(result.get(4)).toBe(4);
  });

  it("jumps over an explicit bin that sits ahead of the fill sequence", () => {
    // The shape production data actually has: hand-placed bins scattered
    // through a box, unbinned parts filling the gaps around them.
    const parts = [
      part(1, 100, "B9", 1),
      part(2, 200, "B9", null),
      part(3, 300, "B9", null),
      part(4, 400, "B9", 4),
      part(5, 500, "B9", null),
    ];
    const result = assignBins(parts);
    expect(result.get(2)).toBe(2);
    expect(result.get(3)).toBe(3);
    expect(result.get(5)).toBe(5);
  });

  it("ignores parts with no location", () => {
    const parts = [part(1, 100, null, null)];
    expect(assignBins(parts).size).toBe(0);
  });
});

describe("allocateBins", () => {
  it("refuses to allocate when occupancy is unknown — never guesses bin 1", () => {
    expect(allocateBins("B9", 1, OCCUPANCY_UNKNOWN, [])).toBeNull();
  });

  it("refuses to allocate when occupancy is unknown, even with queued parts", () => {
    const queued = [part(1, 100, "B9", 5)];
    expect(allocateBins("B9", 1, OCCUPANCY_UNKNOWN, queued)).toBeNull();
  });

  it("allocates the first free bin in an empty, known-empty box", () => {
    expect(allocateBins("B9", 1, [], [])).toEqual([1]);
  });

  it("allocates around bins already occupied by stored parts", () => {
    const stored = [part(1, 100, "B9", 1), part(2, 101, "B9", 2)];
    expect(allocateBins("B9", 1, stored, [])).toEqual([3]);
  });

  it("allocates around bins already claimed by other queued (unsaved) parts", () => {
    const queued = [part(1, 100, "B9", 1), part(2, 101, "B9", 2)];
    expect(allocateBins("B9", 1, [], queued)).toEqual([3]);
  });

  it("does not collide when both stored and queued parts occupy bins", () => {
    const stored = [part(1, 100, "B9", 1)];
    const queued = [part(2, 200, "B9", 2)];
    expect(allocateBins("B9", 1, stored, queued)).toEqual([3]);
  });

  it("hands out multiple free bins in order without colliding with each other", () => {
    const stored = [part(1, 100, "B9", 2)];
    expect(allocateBins("B9", 3, stored, [])).toEqual([1, 3, 4]);
  });

  it("ignores queued parts with no bin yet (bin_number 0)", () => {
    const queued = [part(1, 100, "B9", 0)];
    expect(allocateBins("B9", 1, [], queued)).toEqual([1]);
  });

  it("ignores stored/queued occupants in a different box", () => {
    const stored = [part(1, 100, "B8", 1)];
    const queued = [part(2, 200, "B8", 2)];
    expect(allocateBins("B9", 1, stored, queued)).toEqual([1]);
  });
});
