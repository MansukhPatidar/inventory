import { describe, it, expect } from "vitest";
import { groupBomLines, groupedLineToBomLine } from "./bom-group";
import type { BomLine } from "./bom-parse";

let bomNo = 1;
function bomLine(overrides: Partial<BomLine>): BomLine {
  return {
    no: bomNo++,
    quantity: "1",
    comment: "",
    designator: "",
    footprint: "",
    value: "",
    mpn: "",
    manufacturer: "",
    supplierPart: "",
    supplier: "",
    ...overrides,
  };
}

describe("groupBomLines — same value/footprint, different MPN (C50/C51 shape)", () => {
  it("groups two 150pF/C0603 lines with different MPNs into one group", () => {
    const lines = [
      bomLine({
        designator: "C50",
        quantity: "1",
        comment: "150pF",
        value: "150pF",
        footprint: "C0603",
        mpn: "CL10C151JB8NNNC",
      }),
      bomLine({
        designator: "C51",
        quantity: "1",
        comment: "150pF",
        value: "150pF",
        footprint: "C0603",
        mpn: "0603N151J500CT",
      }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(1);
    expect(groups[0].designator).toBe("C50,C51");
    expect(groups[0].quantity).toBe(2);
    expect(groups[0].mergedCount).toBe(2);
    expect(groups[0].mpns.sort()).toEqual(
      ["0603N151J500CT", "CL10C151JB8NNNC"].sort()
    );
    expect(groups[0].members.length).toBe(2);
  });
});

describe("groupBomLines — 3-way 1kΩ/R0603 case", () => {
  it("groups three 1kΩ/R0603 lines with summed qty 8 and 3 distinct MPNs", () => {
    const lines = [
      bomLine({
        designator: "R4",
        quantity: "1",
        value: "1kΩ",
        footprint: "R0603",
        mpn: "0603WAF1001T5E",
      }),
      bomLine({
        designator: "R26,R34,R36,R38",
        quantity: "4",
        value: "1kΩ",
        footprint: "R0603",
        mpn: "RC0603FR-071KL",
      }),
      bomLine({
        designator: "R32,R33,R40",
        quantity: "3",
        value: "1kΩ",
        footprint: "R0603",
        mpn: "AF0603FR-071KL",
      }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.mergedCount).toBe(3);
    expect(g.quantity).toBe(8);
    expect(g.mpns.length).toBe(3);
    expect(g.designator).toBe("R4,R26,R34,R36,R38,R32,R33,R40");
  });
});

describe("groupBomLines — unit-normalized equivalence", () => {
  it("groups 100nF and 0.1uF in the same footprint", () => {
    const lines = [
      bomLine({ designator: "C1", quantity: "1", value: "100nF", footprint: "C0603" }),
      bomLine({ designator: "C2", quantity: "1", value: "0.1uF", footprint: "C0603" }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(1);
    expect(groups[0].designator).toBe("C1,C2");
    expect(groups[0].quantity).toBe(2);
  });
});

describe("groupBomLines — footprint discrimination", () => {
  it("does not group the same value across different footprints (C0603 vs C0805)", () => {
    const lines = [
      bomLine({ designator: "C1", quantity: "1", value: "10uF", footprint: "C0603" }),
      bomLine({ designator: "C2", quantity: "1", value: "10uF", footprint: "C0805" }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(2);
  });
});

describe("groupBomLines — value discrimination", () => {
  it("does not group different values in the same footprint", () => {
    const lines = [
      bomLine({ designator: "R1", quantity: "1", value: "1kΩ", footprint: "R0603" }),
      bomLine({ designator: "R2", quantity: "1", value: "2kΩ", footprint: "R0603" }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(2);
  });
});

describe("groupBomLines — no-value lines (ICs, connectors)", () => {
  it("does not merge two distinct ICs with no parsable value", () => {
    const lines = [
      bomLine({
        designator: "U1",
        quantity: "1",
        comment: "ESP32-S3-WROOM-1",
        mpn: "ESP32-S3-WROOM-1",
        footprint: "Module",
      }),
      bomLine({
        designator: "U2",
        quantity: "1",
        comment: "AO3401",
        mpn: "AO3401",
        footprint: "SOT-23",
      }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(2);
  });

  it("merges two identical no-value entries (same MPN, same footprint)", () => {
    const lines = [
      bomLine({
        designator: "U1",
        quantity: "1",
        comment: "AO3401",
        mpn: "AO3401",
        footprint: "SOT-23",
      }),
      bomLine({
        designator: "U5",
        quantity: "2",
        comment: "AO3401",
        mpn: "AO3401",
        footprint: "SOT-23",
      }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(1);
    expect(groups[0].designator).toBe("U1,U5");
    expect(groups[0].quantity).toBe(3);
    expect(groups[0].mergedCount).toBe(2);
  });

  it("falls back to comment when mpn is absent for no-value lines", () => {
    const lines = [
      bomLine({
        designator: "J1",
        quantity: "1",
        comment: "USB-C Connector",
        footprint: "USB-C-SMD",
      }),
      bomLine({
        designator: "J2",
        quantity: "1",
        comment: "USB-C Connector",
        footprint: "USB-C-SMD",
      }),
      bomLine({
        designator: "J3",
        quantity: "1",
        comment: "Barrel Jack",
        footprint: "USB-C-SMD",
      }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(2);
    const usbGroup = groups.find((g) => g.comment === "USB-C Connector")!;
    expect(usbGroup.designator).toBe("J1,J2");
    expect(usbGroup.quantity).toBe(2);
  });
});

describe("groupBomLines — unknown footprint handling", () => {
  it("treats two unstated footprints as the same (both null) when values match", () => {
    const lines = [
      bomLine({ designator: "R1", quantity: "1", value: "1kΩ", footprint: "" }),
      bomLine({ designator: "R2", quantity: "1", value: "1kΩ", footprint: "--" }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(1);
    expect(groups[0].quantity).toBe(2);
  });
});

describe("groupBomLines — quantity parsing", () => {
  it("sums non-numeric-safe quantities, treating unparsable ones as 0", () => {
    const lines = [
      bomLine({ designator: "R1", quantity: "2", value: "1kΩ", footprint: "R0603" }),
      bomLine({ designator: "R2", quantity: "abc", value: "1kΩ", footprint: "R0603" }),
    ];
    const groups = groupBomLines(lines);
    expect(groups.length).toBe(1);
    expect(groups[0].quantity).toBe(2);
  });
});

describe("groupBomLines — preserves originals and order", () => {
  it("keeps the original member BomLines untouched and groups in first-appearance order", () => {
    const first = bomLine({ designator: "C5", quantity: "1", value: "10uF", footprint: "C0603" });
    const second = bomLine({ designator: "R1", quantity: "1", value: "1kΩ", footprint: "R0603" });
    const third = bomLine({ designator: "C23", quantity: "1", value: "10uF", footprint: "C0603" });
    const groups = groupBomLines([first, second, third]);
    expect(groups.length).toBe(2);
    expect(groups[0].members).toEqual([first, third]);
    expect(groups[0].members[0]).toBe(first);
    expect(groups[1].members).toEqual([second]);
  });
});

describe("groupedLineToBomLine", () => {
  it("produces a BomLine-shaped object suitable for reconcile()", () => {
    const lines = [
      bomLine({
        designator: "C50",
        quantity: "1",
        comment: "150pF",
        value: "150pF",
        footprint: "C0603",
        mpn: "CL10C151JB8NNNC",
      }),
      bomLine({
        designator: "C51",
        quantity: "1",
        comment: "150pF",
        value: "150pF",
        footprint: "C0603",
        mpn: "0603N151J500CT",
      }),
    ];
    const [group] = groupBomLines(lines);
    const asBomLine = groupedLineToBomLine(group);
    expect(asBomLine.designator).toBe("C50,C51");
    expect(asBomLine.quantity).toBe("2");
    expect(asBomLine.value).toBe("150pF");
    expect(asBomLine.footprint).toBe("C0603");
  });
});
