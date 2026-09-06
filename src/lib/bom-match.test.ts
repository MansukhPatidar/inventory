import { describe, it, expect } from "vitest";
import {
  reconcile,
  parseValue,
  normPackage,
  findRelaxedCandidates,
  packageFamily,
} from "./bom-match";
import type { BomLine } from "./bom-parse";
import type { Part } from "./types";
import type { ReconciledLine } from "./bom-match";

let nextId = 1;
function part(overrides: Partial<Part>): Part {
  const id = nextId++;
  return {
    id,
    item_code: id,
    item_name: "Some Part",
    package: null,
    location: "B1",
    details: null,
    qty: 10,
    bin_number: 1,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let bomNo = 1;
function bomLine(overrides: Partial<BomLine>): BomLine {
  return {
    no: bomNo++,
    quantity: "",
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

describe("parseValue", () => {
  it("parses picofarads", () => {
    expect(parseValue("15pF")).toEqual({ qty: 15e-12, kind: "farad" });
  });

  it("parses R/K/M resistor shorthand (4k7)", () => {
    expect(parseValue("4k7")).toEqual({ qty: 4700, kind: "ohm" });
  });

  it("parses nanofarads", () => {
    const parsed = parseValue("100nF");
    expect(parsed?.kind).toBe("farad");
    expect(parsed?.qty).toBeCloseTo(100e-9, 12);
  });

  it("parses the omega symbol as ohms", () => {
    const parsed = parseValue("10kΩ");
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe("ohm");
    expect(parsed!.qty).toBeCloseTo(10e3, 6);
  });

  // Mega vs milli is the one SI prefix pair where case genuinely matters, and
  // getting it wrong is a 1e9 error: a 2.2MΩ resistor read as 2.2 milliohms
  // silently fails to match anything. Every other prefix folds case, because
  // real inventory text is sloppy (`100NF`, `4.7uf`).
  it("reads an uppercase M as mega, not milli", () => {
    expect(parseValue("4.99MΩ")!.qty).toBeCloseTo(4.99e6, 0);
    expect(parseValue("2.2MΩ")!.qty).toBeCloseTo(2.2e6, 0);
    expect(parseValue("10M Ohm")!.qty).toBeCloseTo(10e6, 0);
    expect(parseValue("16MHz")!.qty).toBeCloseTo(16e6, 0);
    expect(parseValue("16MHz")!.kind).toBe("hertz");
  });

  it("reads a lowercase m as milli, not mega", () => {
    expect(parseValue("25mΩ")!.qty).toBeCloseTo(25e-3, 9);
    expect(parseValue("100mΩ")!.qty).toBeCloseTo(100e-3, 9);
  });

  it("accepts an explicit Meg prefix as mega", () => {
    const megParsed = parseValue("4.99MegΩ");
    expect(megParsed).not.toBeNull();
    expect(megParsed!.kind).toBe("ohm");
    expect(megParsed!.qty).toBeCloseTo(4.99e6, 0);
  });

  it("still folds case for prefixes that are not ambiguous", () => {
    expect(parseValue("100NF")!.qty).toBeCloseTo(100e-9, 12);
    expect(parseValue("4.7uf")!.qty).toBeCloseTo(4.7e-6, 9);
    expect(parseValue("10K")!.qty).toBeCloseTo(10e3, 6);
  });

  it("parses bare EIA 3-digit codes as picofarads (significant digits + power-of-ten multiplier)", () => {
    // "220" -> significand 22, multiplier 10^0 -> 22pF
    const parsed = parseValue("220");
    expect(parsed?.kind).toBe("farad");
    expect(parsed?.qty).toBeCloseTo(22e-12, 15);
  });
});

describe("normPackage", () => {
  it("strips the C prefix from a 4-digit chip code (C0603 -> 0603)", () => {
    expect(normPackage("C0603")).toBe("0603");
  });

  it("strips a _-suffixed dimension tail (SOT-23-3_L2.9-... -> SOT-23-3)", () => {
    expect(normPackage("SOT-23-3_L2.9-W1.6-P0.95-LS2.8-BL")).toBe("SOT-23-3");
  });

  it("treats null/empty/--/SMD as unknown (null)", () => {
    expect(normPackage(null)).toBeNull();
    expect(normPackage("")).toBeNull();
    expect(normPackage("--")).toBeNull();
    expect(normPackage("SMD")).toBeNull();
  });
});

describe("reconcile — MPN tier", () => {
  it("matches an exact MPN buried in free-text details", () => {
    const parts = [
      part({
        item_name: "100nF 0603 Capacitor",
        details: "Murata GRM188R71H104KA93D 100nF X7R 50V",
        package: "C0603",
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 100nF 0603",
        mpn: "GRM188R71H104KA93D",
        value: "100nF",
        footprint: "C0603",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("green");
    expect(result.candidates[0].tier).toBe("mpn");
    expect(result.candidates[0].part.id).toBe(parts[0].id);
  });
});

describe("reconcile — supplier tier false-positive guard", () => {
  it("does not let C15 substring-match an entry containing C1591", () => {
    const parts = [
      part({
        item_name: "10uF 0805 Capacitor",
        details: "LCSC C1591 10uF 25V X5R 0805",
        package: "C0805",
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 10uF 0805",
        supplierPart: "C15",
      }),
    ];
    const [result] = reconcile(lines, parts);
    // C15 must not hit the supplier tier against C1591 — it's too short to
    // even attempt the supplier tier (min length 3 satisfied, but must be a
    // whole-token match, and "C15" is not a token in the inventory text).
    expect(result.candidates.every((c) => c.tier !== "supplier")).toBe(true);
  });

  it("matches C1591 as a whole token when the BOM supplier part is exactly C1591", () => {
    const parts = [
      part({
        item_name: "10uF 0805 Capacitor",
        details: "LCSC C1591 10uF 25V X5R 0805",
        package: "C0805",
      }),
      part({
        item_name: "Unrelated part",
        details: "LCSC C15910099 something else entirely",
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 10uF 0805",
        supplierPart: "C1591",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("green");
    expect(result.candidates[0].tier).toBe("supplier");
    expect(result.candidates[0].part.details).toContain("C1591 10uF");
  });
});

describe("reconcile — value+package tier", () => {
  it("discriminates 0603 vs 0805 packages for the same value", () => {
    const parts = [
      part({
        item_name: "100nF Capacitor 0603",
        details: "MLCC 100nF X7R 0603",
        package: "C0603",
      }),
      part({
        item_name: "100nF Capacitor 0805",
        details: "MLCC 100nF X7R 0805",
        package: "C0805",
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 100nF",
        value: "100nF",
        footprint: "C0805",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("green");
    expect(result.candidates[0].tier).toBe("value+package");
    expect(result.candidates[0].part.package).toBe("C0805");
    // The mismatched-package 0603 part is blocked from the value+package tier
    // entirely — it can only fall through to a low-score fuzzy candidate,
    // which must never outrank the correct 0805 value+package match.
    const mismatched = result.candidates.find((c) => c.part.package === "C0603");
    if (mismatched) {
      expect(mismatched.tier).toBe("fuzzy");
      expect(mismatched.score).toBeLessThan(result.candidates[0].score);
    }
  });

  it("does not block when the inventory package is unknown, but lowers score vs. a known match", () => {
    const parts = [
      part({
        item_name: "100nF Capacitor, unknown package",
        details: "MLCC 100nF X7R",
        package: null,
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 100nF",
        value: "100nF",
        footprint: "C0603",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("green");
    expect(result.candidates[0].tier).toBe("value+package");
    // bomPkg known, entry.pkg unknown -> pkgScore 0.5 -> score 0.75
    expect(result.candidates[0].score).toBeCloseTo(0.75, 5);
  });
});

describe("reconcile — fuzzy tier", () => {
  it("falls back to a fuzzy amber match when nothing else hits", () => {
    const parts = [
      part({
        item_name: "ESP32-S3-WROOM-1 Module",
        details: "Espressif WiFi/BLE module, 16MB flash",
        package: "Module",
      }),
    ];
    const lines = [
      bomLine({
        comment: "ESP32 S3 WROOM Module",
        designator: "U1",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("amber");
    expect(result.candidates[0].tier).toBe("fuzzy");
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.35);
  });

  it("reports red when no candidate clears any tier's threshold", () => {
    const parts = [
      part({
        item_name: "Totally Unrelated Widget",
        details: "Nothing like the BOM line at all",
      }),
    ];
    const lines = [
      bomLine({
        comment: "XYZQ Zorbulator Flange",
        value: "",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("red");
    expect(result.candidates.length).toBe(0);
  });
});

describe("reconcile — quantity independence", () => {
  it("never lets quantity affect status, even with a zero or mismatched qty", () => {
    const parts = [
      part({
        item_name: "100nF 0603 Capacitor",
        details: "Murata GRM188R71H104KA93D 100nF X7R 50V",
        package: "C0603",
        qty: 0,
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 100nF 0603",
        mpn: "GRM188R71H104KA93D",
        value: "100nF",
        footprint: "C0603",
        quantity: "999",
      }),
    ];
    const [result] = reconcile(lines, parts);
    expect(result.status).toBe("green");
    expect(result.candidates[0].part.qty).toBe(0);
  });
});

/** Run reconcile() on a single line and assert it came back red, returning
 * the ReconciledLine for use with findRelaxedCandidates. */
function redLineFor(line: BomLine, parts: Part[]): ReconciledLine {
  const [result] = reconcile([line], parts);
  expect(result.status).toBe("red");
  return result;
}

describe("findRelaxedCandidates — exact-value-other-package", () => {
  it("finds an 0805 33k for a red 33k 0603 line (real-data shape)", () => {
    const parts = [
      part({
        item_name: "33k 1/8w",
        details:
          "RC0805FR-0733KL-YAGEO-Res Thick Film 0805 33K Ohm 1% 0.125W(1/8W) ±100ppm/°C Pad SMD T/R",
        package: "0805",
      }),
    ];
    const line = bomLine({
      comment: "33kΩ",
      value: "33kΩ",
      footprint: "R0603",
      mpn: "0603WAF3302T5E",
      designator: "R27,R55",
    });
    const red = redLineFor(line, parts);
    const relaxed = findRelaxedCandidates(red, parts);
    expect(relaxed.length).toBeGreaterThan(0);
    expect(relaxed[0].reason).toBe("exact-value-other-package");
    expect(relaxed[0].part.item_name).toBe("33k 1/8w");
    expect(relaxed[0].crossFamily).toBe(false);
  });

  it("finds an 0805 220R for a red 220R 0603 line (real-data shape)", () => {
    const parts = [
      part({
        item_name: "220R",
        details:
          "RC0805JR-07220RL-YAGEO-Res Thick Film 0805 220 Ohm 5% 0.125W(1/8W) ±100ppm/°C Pad SMD T/R",
        package: "0805",
      }),
    ];
    const line = bomLine({
      comment: "220Ω",
      value: "220Ω",
      footprint: "R0603",
      mpn: "FRC0603J221 TS",
      designator: "R44",
    });
    const red = redLineFor(line, parts);
    const relaxed = findRelaxedCandidates(red, parts);
    expect(relaxed.length).toBeGreaterThan(0);
    expect(relaxed[0].reason).toBe("exact-value-other-package");
    expect(relaxed[0].part.item_name).toBe("220R");
  });
});

describe("findRelaxedCandidates — active parts are not passive substitutes", () => {
  // A MOSFET's on-resistance, an inductor's DC resistance and a ferrite
  // bead's impedance all read as plain ohm values, so without an
  // inventory-side guard an IRFP9540 gets offered as a substitute for a
  // 100mOhm current-shunt resistor. It is not one.
  const shuntLine = () =>
    bomLine({
      comment: "100mΩ",
      value: "100mΩ",
      footprint: "RES-SMD_L6.4-W3.2-R2512",
      mpn: "CRA2512-FZ-R100ELF",
      designator: "R11",
    });

  it("does not offer a MOSFET whose on-resistance matches the wanted value", () => {
    const parts = [
      part({
        item_name: "AO3401-ED-HXY",
        details: "MOSFET-20V 3A 120mΩ@4.5V,2A 700mW SOT-23",
        package: null,
      }),
      part({
        item_name: "IRFP9540",
        details: "IRFP9540 P-Channel MOSFET 100V 23A 117mOhm TO-220",
        package: "TO-220",
      }),
    ];
    expect(findRelaxedCandidates(redLineFor(shuntLine(), parts), parts)).toEqual(
      []
    );
  });

  it("does not offer an inductor whose DC resistance matches", () => {
    const parts = [
      part({
        item_name: "MWSA0605S-150MT-Sunlord",
        details: "15uH 3.1A 20% 90mOhm Unshielded Power Inductor",
        package: "SMD",
      }),
    ];
    expect(findRelaxedCandidates(redLineFor(shuntLine(), parts), parts)).toEqual(
      []
    );
  });

  it("does not offer a ferrite bead as a resistor", () => {
    // A bead's "100Ω@100MHz" is an impedance rating, not a resistance. The
    // BOM line here wants a 2512 shunt, so the 0603 bead cannot satisfy the
    // strict tiers and the line genuinely reaches relaxed matching.
    const parts = [
      part({
        item_name: " 100Ω@100MHz 0603 Ferrite Beads",
        details: "Ferrite bead 100 Ohm at 100MHz, 0603",
        package: "0603",
      }),
    ];
    const line = bomLine({
      comment: "100Ω",
      value: "100Ω",
      footprint: "RES-SMD_L6.4-W3.2-R2512",
      mpn: "CRA2512-FZ-R100ELF",
      designator: "R99",
    });
    const red = redLineFor(line, parts);
    expect(red.status).toBe("red");
    expect(findRelaxedCandidates(red, parts)).toEqual([]);
  });

  it("still offers a genuine chip resistor of the same value", () => {
    const parts = [
      part({ item_name: "100mΩ", details: "100 milliohm shunt", package: "2512" }),
    ];
    const relaxed = findRelaxedCandidates(redLineFor(shuntLine(), parts), parts);
    expect(relaxed.length).toBe(1);
    expect(relaxed[0].reason).toBe("exact-value-other-package");
  });
});

describe("packageFamily — chip size embedded in a footprint tail", () => {
  // normPackage() truncates at the first underscore, so the 2512 in an
  // EasyEDA footprint tail would otherwise be lost and the part wrongly
  // labelled a cross-family guess.
  it("reads the chip size out of an EasyEDA dimension tail", () => {
    expect(packageFamily("RES-SMD_L6.4-W3.2-R2512")).toBe("chip");
  });

  it("still classifies a plain chip size and leaves unrelated packages alone", () => {
    expect(packageFamily("0603")).toBe("chip");
    expect(packageFamily("R2512")).toBe("chip");
    expect(packageFamily("TO-220")).not.toBe("chip");
  });

  it("treats a 2512 shunt and a 2512 chip resistor as the same family", () => {
    const parts = [
      part({ item_name: "3W 100mΩ  ±1% ", details: "2512 shunt", package: "R2512" }),
    ];
    const line = bomLine({
      comment: "100mΩ",
      value: "100mΩ",
      footprint: "RES-SMD_L6.4-W3.2-R2512",
      mpn: "CRA2512-FZ-R100ELF",
      designator: "R11",
    });
    const relaxed = findRelaxedCandidates(redLineFor(line, parts), parts);
    expect(relaxed.length).toBe(1);
    expect(relaxed[0].crossFamily).toBe(false);
  });
});

describe("findRelaxedCandidates — semiconductor guard", () => {
  it("returns no candidates for a red AO3400 MOSFET line", () => {
    const parts = [
      part({
        item_name: "AO3401",
        details: "AO3401-ED-HXY MOSFET P-Channel SOT-23",
        package: "SOT-23",
      }),
      part({
        item_name: "Some unrelated resistor",
        details: "10k 0603 resistor",
        package: "0603",
      }),
    ];
    const line = bomLine({
      comment: "AO3400",
      value: "",
      footprint: "SOT-23-3_L2.9-W1.3-P1.90-LS2.4-BR",
      mpn: "AO3400",
      designator: "Q13",
    });
    const red = redLineFor(line, parts);
    const relaxed = findRelaxedCandidates(red, parts);
    expect(relaxed).toEqual([]);
  });
});

describe("findRelaxedCandidates — package families", () => {
  it("ranks a same-family suggestion above a cross-family one", () => {
    const parts = [
      part({
        item_name: "10uF electrolytic can",
        details: "220uF 25V SMD electrolytic",
        package: "D8xL10.5mm",
      }),
      part({
        item_name: "1206 ceramic 220uF-shaped value coincidence",
        details: "220uF something unrelated chip part",
        package: "1206",
      }),
    ];
    const line = bomLine({
      comment: "220uF",
      value: "220uF",
      footprint: "CAP-SMD_BD6.3-L6.6-W6.6-LS7.4-FD",
      designator: "C27",
    });
    const red = redLineFor(line, parts);
    const relaxed = findRelaxedCandidates(red, parts);
    expect(relaxed.length).toBe(2);
    const smdCan = relaxed.find((c) => c.part.package === "D8xL10.5mm")!;
    const chip = relaxed.find((c) => c.part.package === "1206")!;
    expect(smdCan.crossFamily).toBe(false);
    expect(chip.crossFamily).toBe(true);
    expect(relaxed.indexOf(smdCan)).toBeLessThan(relaxed.indexOf(chip));
  });
});

describe("findRelaxedCandidates — near-value banding", () => {
  it("includes a same-package value about 10% off but excludes one about 50% off", () => {
    const parts = [
      part({
        item_name: "47k 0603 (10% off)",
        details: "Res 0603 47kΩ 1%",
        package: "0603",
      }),
      part({
        item_name: "150k 0603 (way off)",
        details: "Res 0603 150kΩ 1%",
        package: "0603",
      }),
    ];
    // BOM wants 43k, which is not in inventory; 47k is ~9.3% off (near),
    // 150k is way outside any reasonable band.
    const line = bomLine({
      comment: "43kΩ",
      value: "43kΩ",
      footprint: "R0603",
      designator: "R99",
    });
    const red = redLineFor(line, parts);
    const relaxed = findRelaxedCandidates(red, parts);
    const names = relaxed.map((c) => c.part.item_name);
    expect(names).toContain("47k 0603 (10% off)");
    expect(names).not.toContain("150k 0603 (way off)");
  });
});

describe("findRelaxedCandidates — never touches green/amber lines", () => {
  it("does not change an existing green line's status or top candidate", () => {
    const parts = [
      part({
        item_name: "100nF 0603 Capacitor",
        details: "Murata GRM188R71H104KA93D 100nF X7R 50V",
        package: "C0603",
      }),
    ];
    const line = bomLine({
      comment: "CAP 100nF 0603",
      mpn: "GRM188R71H104KA93D",
      value: "100nF",
      footprint: "C0603",
    });
    const [result] = reconcile([line], parts);
    expect(result.status).toBe("green");
    // findRelaxedCandidates is guarded by status, not by tier — calling it
    // on a non-red line must be a documented no-op regardless of input.
    expect(findRelaxedCandidates(result, parts)).toEqual([]);
  });

  it("does not change an existing amber (fuzzy) line's status or top candidate", () => {
    const parts = [
      part({
        item_name: "ESP32-S3-WROOM-1 Module",
        details: "Espressif WiFi/BLE module, 16MB flash",
        package: "Module",
      }),
    ];
    const line = bomLine({
      comment: "ESP32 S3 WROOM Module",
      designator: "U1",
    });
    const [result] = reconcile([line], parts);
    expect(result.status).toBe("amber");
    expect(findRelaxedCandidates(result, parts)).toEqual([]);
  });

  it("running relaxed matching for red lines does not perturb the strict reconcile() output for the rest of the batch", () => {
    const parts = [
      part({
        item_name: "100nF 0603 Capacitor",
        details: "Murata GRM188R71H104KA93D 100nF X7R 50V",
        package: "C0603",
      }),
      part({
        item_name: "33k 1/8w",
        details: "RC0805FR-0733KL-YAGEO 0805 33K Ohm 1% 1/8W",
        package: "0805",
      }),
    ];
    const lines = [
      bomLine({
        comment: "CAP 100nF 0603",
        mpn: "GRM188R71H104KA93D",
        value: "100nF",
        footprint: "C0603",
      }),
      bomLine({
        comment: "33kΩ",
        value: "33kΩ",
        footprint: "R0603",
        designator: "R27",
      }),
    ];
    const before = reconcile(lines, parts);
    // Simulate the app calling findRelaxedCandidates for the red line only.
    before.forEach((r) => {
      if (r.status === "red") findRelaxedCandidates(r, parts);
    });
    const after = reconcile(lines, parts);
    expect(after[0].status).toBe(before[0].status);
    expect(after[0].candidates[0]?.part.id).toBe(before[0].candidates[0]?.part.id);
    expect(after[1].status).toBe(before[1].status);
  });
});
