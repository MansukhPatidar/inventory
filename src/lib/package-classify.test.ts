import { describe, it, expect } from "vitest";
import { classifyPackage, canonicalPackage } from "./package-classify";

/**
 * The fixture below is a real Robu order paste (31 lines). Labels are
 * hand-assigned from the datasheet package named in each description —
 * including the lines that MUST return "" because the description genuinely
 * names no package. Suppressing a false guess is worth as much as making a
 * true one, so those empty cases are assertions, not omissions.
 */
const ORDER_LINES: Array<{ name: string; pkg: string; note?: string }> = [
  {
    name: "BAV199-Slkor-85V 1.25V 3us 160mA SOT-23 Switching Diodes ROHS",
    pkg: "SOT-23",
  },
  {
    name: "SL8552XS8-Slkor-Dual 0.8V/us 2MHz rail-to-rail input,rail-to-rail output 15uV SOP-8 Operational Amplifier ROHS",
    pkg: "SOP-8",
  },
  {
    name: "SL9061A-Slkor-SOT-23-5 Operational Amplifier ROHS",
    pkg: "SOT-23-5",
    note: "more specific SOT-23-5 must beat the SOT-23 prefix",
  },
  {
    name: "SN74AVC8T245PWR-Texas Instruments-1 8 TSSOP-24 Translators, Level Shifters ROHS",
    pkg: "TSSOP-24",
  },
  {
    name: "FocuSens Ring Terminal NTC BMS Temperature Sensor",
    pkg: "",
    note: "no package named anywhere",
  },
  {
    name: "ADR01BRZ-REEL7-ANALOG DEVICES-Voltage Reference, 3ppm/°C, 10V, 0.05%, Series - Fixed, NSOIC-8, -40°C to 125°C",
    pkg: "SOIC-8",
    note: "NSOIC-8 (narrow SOIC) canonicalizes to SOIC-8",
  },
  {
    name: "MAX6071BAUT33+T-Analog Devices-Voltage Reference, Series - Fixed, MAX6071 Series, 3.3V, 0.08 %, ± 2ppm/°C, SOT-23-6",
    pkg: "SOT-23-6",
  },
  {
    name: "2.2K Ohm 1/4w 1206 Resistor",
    pkg: "1206",
    note: "bare chip size not starting with 0",
  },
  {
    name: "HoYLR2512-2W-25mR-1%-Milliohm-2W 25mΩ Patch Current Sensing Resistors ±1% 2512 Current Sense Resistors / Shunt Resistors ROHS",
    pkg: "2512",
  },
  {
    name: "TLV431TFTA-DIODES INC.-VOLT REF, SHUNT, 1.24V, -40 TO 125DEG C",
    pkg: "",
    note: "'TO 125DEG' must not be read as a TO-xxx package",
  },
  {
    name: "TCC0603COG151J101CT-CCTC-SMT ceramic capacitors 0603 COG 151J(150pF)±5.0% Rated voltage:100V thickness:0.80mm tape",
    pkg: "0603",
  },
  {
    name: "RLTZ-100uF 25V D6.3xL7.8mm SMD Polymer Aluminum Capacitors ROHS",
    pkg: "D6.3xL7.8mm",
    note: "dimensional can package beats the bare SMD fallback",
  },
  {
    name: "TL431-GOODWORK-36V 37V 100mA Adjustable SOT-23 Voltage Reference ROHS",
    pkg: "SOT-23",
  },
  {
    name: "SD103CW-JSCJ-20V 600mV@200mA 350mA SOD-123 Schottky Diodes ROHS",
    pkg: "SOD-123",
  },
  {
    name: "PMBT3906-PAKER-40V 200mW 300 200mA PNP SOT-23 Bipolar (BJT) ROHS",
    pkg: "SOT-23",
  },
  {
    name: "AC0603FR-0747KL-YAGEO-Res Thick Film 0603 47K Ohm 1% 0.1W(1/10W) ±100ppm/°C Pad SMD T/R Automotive AEC-Q200",
    pkg: "0603",
  },
  {
    name: "AC0603FR-0733K2L-Yageo-100mW Thick Film Resistors 75V ±100ppm/℃ ±1% 33.2kΩ 0603 Chip Resistor - Surface Mount ROHS",
    pkg: "0603",
  },
  {
    name: "AC0603JR-07220RL-YAGEO-Res Thick Film 0603 220 Ohm 5% 0.1W(1/10W) ±100ppm/°C Pad SMD T/R Automotive AEC-Q200",
    pkg: "0603",
  },
  {
    name: "RC1206JR-074K7L-Yageo-SMD Chip Resistor, 4.7 kohm, ± 5%, 250 mW, 1206 [3216 Metric], Thick Film, General Purpose",
    pkg: "1206",
    note: "1206 must win over the earlier-appearing SMD",
  },
  {
    name: "AC0603JR-134K7L-YAGEO-100mW Thick Film Resistors ±100ppm/℃ ±5% 4.7kΩ 0603 Chip Resistor - Surface Mount ROHS",
    pkg: "0603",
  },
  {
    name: "CL31B106KLHNNNE-Samsung-Cap Ceramic 10uF 35V X7R 10% Pad SMD 1206 125°C T/R",
    pkg: "1206",
    note: "1206 must win over the earlier-appearing SMD",
  },
  {
    name: "H2101M035C080HY-HYNCDZ-35V 100uF ±20% Through Hole,D6.3xL8mm Aluminum - Polymer Capacitors RoHS",
    pkg: "D6.3xL8mm",
    note: "dimensional beats the Through Hole fallback",
  },
  {
    name: "MWSA0605S-150MT-Sunlord-15uH 3.1A 20% 90mOhm Unshielded Wirewound Power Inductor SMD",
    pkg: "",
    note: "MWSA0605S is an MPN series code, not a chip size; only SMD remains, which is not a footprint",
  },
  {
    name: "0.5 Ohm 3W Surface Mount Sense Resistor",
    pkg: "",
    note: "Surface Mount is a mount style, not a footprint",
  },
  {
    name: "ADS1232 24Bit Low Noise AD Analog To Digital Converter Module",
    pkg: "",
    note: "a module board, no IC package; 1232 must not be read as a chip size",
  },
  {
    name: "SLSRV05-4-Slkor-6V Unidirectional 5V SOT-23-6 ESD and Surge Protection (TVS/ESD) ROHS",
    pkg: "SOT-23-6",
  },
  {
    name: "INA213AIDCKR-TEXAS INSTRUMENTS-Current Sense Amplifier, High Side, Low Side, 80 kHz, SC-70, 6 Pins, -40 °C, 125 °C",
    pkg: "SC-70",
  },
  {
    name: "OVZ101M1ETR-0606-LELON-25V 100uF ±20% SMD,D6.3xL5.9mm Solid Capacitors ROHS",
    pkg: "D6.3xL5.9mm",
    note: "0606 here is a LELON case code, not an imperial chip size",
  },
  {
    name: "5 Pin JST XH 2.54mm Pitch Plug and Socket with Cable",
    pkg: "",
    note: "connector with a pitch, not a footprint",
  },
  {
    name: "OVZ101M1CTR-0606-LELON-16V 100uF ±20% 24mΩ@100kHz~300kHz 2.49A@100kHz SMD,D6.3xL5.9mm Solid Capacitors ROHS",
    pkg: "D6.3xL5.9mm",
  },
  { name: "DC Jack-JDH-02", pkg: "", note: "no package named" },
];

describe("classifyPackage — real Robu order paste", () => {
  for (const { name, pkg, note } of ORDER_LINES) {
    const label = pkg === "" ? "(none)" : pkg;
    const suffix = note ? ` — ${note}` : "";
    it(`${label} <- ${name.slice(0, 56)}${suffix}`, () => {
      expect(classifyPackage(name).package).toBe(pkg);
    });
  }

  it("classifies the whole order without a single wrong guess", () => {
    const wrong = ORDER_LINES.filter(
      (l) => classifyPackage(l.name).package !== l.pkg
    );
    expect(wrong.map((w) => w.name)).toEqual([]);
  });
});

describe("classifyPackage — confidence", () => {
  it("marks an explicit package match high confidence", () => {
    const r = classifyPackage("BAV199 85V SOT-23 Switching Diodes");
    expect(r).toMatchObject({ package: "SOT-23", confidence: "high", source: "explicit" });
  });

  it("marks a no-match low confidence with an empty package", () => {
    const r = classifyPackage("FocuSens Ring Terminal NTC BMS Temperature Sensor");
    expect(r).toMatchObject({ package: "", confidence: "low", source: "none" });
  });

  it("marks an SMD-only name low confidence and writes no package", () => {
    const r = classifyPackage("0.5 Ohm 3W Surface Mount Sense Resistor");
    expect(r).toMatchObject({ package: "", confidence: "low", source: "none" });
  });

  it("marks a chip size recovered from the MPN low confidence", () => {
    const r = classifyPackage("RC0805JR-071KL Thick Film Resistor");
    expect(r).toMatchObject({ package: "0805", confidence: "low", source: "mpn" });
  });
});

describe("classifyPackage — specificity ordering", () => {
  it("prefers SOT-23-6 over SOT-23", () => {
    expect(classifyPackage("MAX6071 3.3V SOT-23-6").package).toBe("SOT-23-6");
  });

  it("prefers a chip size over an earlier SMD token", () => {
    expect(classifyPackage("SMD Chip Resistor 4.7k 1206 Thick Film").package).toBe("1206");
  });

  it("prefers a dimensional can over an earlier SMD token", () => {
    expect(classifyPackage("100uF 25V SMD,D6.3xL5.9mm Solid Capacitors").package).toBe(
      "D6.3xL5.9mm"
    );
  });

  it("prefers TSSOP-24 over the SOP-24 substring inside it", () => {
    expect(classifyPackage("SN74AVC8T245PWR TSSOP-24 Level Shifter").package).toBe(
      "TSSOP-24"
    );
  });
});

describe("classifyPackage — false-positive guards", () => {
  it("does not read a temperature range as a TO package", () => {
    expect(classifyPackage("VOLT REF, SHUNT, 1.24V, -40 TO 125DEG C").package).toBe("");
  });

  it("does not read a bare 4-digit number as a chip size", () => {
    expect(classifyPackage("ADS1232 24Bit ADC Module").package).toBe("");
  });

  it("does not read a non-chip case code as a chip size", () => {
    expect(classifyPackage("OVZ101M1ETR-0606-LELON 25V 100uF").package).toBe("");
  });

  it("does not read a connector pitch as a package", () => {
    expect(classifyPackage("5 Pin JST XH 2.54mm Pitch Plug and Socket").package).toBe("");
  });

  it("returns empty for an empty or whitespace name", () => {
    expect(classifyPackage("").package).toBe("");
    expect(classifyPackage("   ").package).toBe("");
  });
});

describe("classifyPackage — snapping to the known vocabulary", () => {
  it("snaps to a known package whose canonical form matches", () => {
    const r = classifyPackage("some part TO220 regulator", ["TO-220"]);
    expect(r.package).toBe("TO-220");
  });

  it("still returns the canonical form when the vocabulary is empty", () => {
    expect(classifyPackage("some part TO220 regulator", []).package).toBe("TO-220");
  });
});

describe("classifyPackage — SOP family variants", () => {
  // These all failed silently before: the pin-counted pattern listed only
  // bare family names, so a body-size prefix meant no match at all and the
  // part was filed with no package.
  it.each([
    ["CH224K WCH ESSOP-10 USB PD Fast Charging Protocol Receiving Chip", "ESOP-10"],
    ["some chip in an NSOP-8 package", "SOP-8"],
    ["a part in VSSOP-8", "VSSOP-8"],
    ["QSOP28 something", "QSOP-28"],
    ["SL1117-3.3-Slkor-SOT-223-3L Voltage Regulators - Linear", "SOT-223-3L"],
    ["SRV05 SOT-23-6L ESD protection", "SOT-23-6L"],
  ])("reads %s as %s", (desc, want) => {
    expect(classifyPackage(desc).package).toBe(want);
  });
});

describe("canonicalPackage", () => {
  it.each([
    ["TO220", "TO-220"],
    ["TO220FB", "TO-220FB"],
    ["DIP8", "DIP-8"],
    ["dip", "DIP"],
    ["DIP 15mm", "DIP-15mm"],
    ["SOP4", "SOP-4"],
    ["SO-8", "SOIC-8"],
    ["R2512", "2512"],
    ["module", "Module"],
    ["MODULE", "Module"],
    ["SOT-32", "SOT-23"],
    ["NSOIC-8", "SOIC-8"],
    ["--", ""],
    ["", ""],
    ["SMD", ""],
    ["TH", "TH"],
    ["SOT-23-3", "SOT-23-3"],
    ["0603", "0603"],
    // N/W is a body width on the SOP and SOIC families, not a footprint.
    ["NSOP-8", "SOP-8"],
    ["NSOP8", "SOP-8"],
    ["WSOP-16", "SOP-16"],
    ["WSOIC-8", "SOIC-8"],
    // ESSOP/VSSOP/QSOP name genuinely different packages and are kept.
    ["ESSOP-10", "ESOP-10"],
    ["VSSOP-8", "VSSOP-8"],
    ["QSOP28", "QSOP-28"],
  ])("canonicalizes %s -> %s", (raw, want) => {
    expect(canonicalPackage(raw)).toBe(want);
  });

  it("leaves dimensional packages intact", () => {
    expect(canonicalPackage("D6.3xL7.8mm")).toBe("D6.3xL7.8mm");
    expect(canonicalPackage("6.3x5.4")).toBe("6.3x5.4");
  });

  it("is idempotent across the existing inventory vocabulary", () => {
    const vocab = [
      "0603", "0805", "1206", "TO-220", "TO220", "DIP-8", "DIP8", "dip",
      "SOP-4", "SOP4", "SO-8", "R2512", "2512", "SOT-23", "SOT-32", "Module",
      "module", "MODULE", "D6.3xL7.8mm", "SMD", "--", "TH-5mm",
    ];
    for (const v of vocab) {
      const once = canonicalPackage(v);
      expect(canonicalPackage(once)).toBe(once);
    }
  });
});
