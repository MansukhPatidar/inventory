import { describe, it, expect } from "vitest";
import {
  formatAddress,
  binOccupants,
  isOutOfRange,
  nextFreeBin,
  assignBins,
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

  it("ignores parts with no location", () => {
    const parts = [part(1, 100, null, null)];
    expect(assignBins(parts).size).toBe(0);
  });
});
