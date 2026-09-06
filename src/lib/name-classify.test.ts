import { describe, it, expect } from "vitest";
import { classifyName, componentType } from "./name-classify";

/**
 * Ground truth comes from two places:
 *
 *  - the same real Robu order paste used by package-classify.test.ts, and
 *  - the naming convention visible in the 271 hand-curated rows already in
 *    the inventory, where `item_name` is a short searchable label and
 *    `details` holds the full supplier blob.
 *
 * Those rows show the rule inverts by component type: an IC or discrete is
 * named by its MPN (UC3845, IRF540, BD139), while a passive is named by its
 * value and key rating (100k 1/8w, 220uF 25V, 10R) and never by its MPN.
 */

describe("componentType", () => {
  it.each([
    ["AC0603FR-0747KL-YAGEO-Res Thick Film 0603 47K Ohm 1% 0.1W", "resistor"],
    ["RC1206JR-074K7L-Yageo-SMD Chip Resistor, 4.7 kohm, 250 mW", "resistor"],
    ["2.2K Ohm 1/4w 1206 Resistor", "resistor"],
    ["HoYLR2512-2W-25mR-1%-Milliohm-2W 25mΩ Current Sensing Resistors", "resistor"],
    ["CL31B106KLHNNNE-Samsung-Cap Ceramic 10uF 35V X7R 10% SMD 1206", "capacitor"],
    ["TCC0603COG151J101CT-CCTC-SMT ceramic capacitors 0603 COG 151J(150pF)", "capacitor"],
    ["RLTZ-100uF 25V D6.3xL7.8mm SMD Polymer Aluminum Capacitors", "capacitor"],
    ["MWSA0605S-150MT-Sunlord-15uH 3.1A 90mOhm Power Inductor SMD", "inductor"],
    ["BAV199-Slkor-85V 1.25V 160mA SOT-23 Switching Diodes ROHS", "diode"],
    ["SD103CW-JSCJ-20V 600mV@200mA SOD-123 Schottky Diodes ROHS", "diode"],
    ["PMBT3906-PAKER-40V 200mW 200mA PNP SOT-23 Bipolar (BJT) ROHS", "transistor"],
    ["SL9061A-Slkor-SOT-23-5 Operational Amplifier ROHS", "ic"],
    ["SN74AVC8T245PWR-Texas Instruments-1 8 TSSOP-24 Translators", "ic"],
    ["5 Pin JST XH 2.54mm Pitch Plug and Socket with Cable", "connector"],
    ["DC Jack-JDH-02", "connector"],
    ["ADS1232 24Bit Low Noise AD Analog To Digital Converter Module", "module"],
  ])("classifies %s as %s", (desc, want) => {
    expect(componentType(desc)).toBe(want);
  });
});

describe("classifyName — passives are named by value and rating", () => {
  it.each([
    // [description, expected item_name]
    // Resistors are named by value alone: 49 of the 62 hand-curated
    // resistor rows omit the wattage, so adding it would disagree with the
    // convention already in the DB.
    ["AC0603FR-0747KL-YAGEO-Res Thick Film 0603 47K Ohm 1% 0.1W(1/10W) ±100ppm/°C Pad SMD T/R Automotive AEC-Q200", "47K"],
    ["AC0603JR-07220RL-YAGEO-Res Thick Film 0603 220 Ohm 5% 0.1W(1/10W) ±100ppm/°C Pad SMD T/R", "220R"],
    ["RC1206JR-074K7L-Yageo-SMD Chip Resistor, 4.7 kohm, ± 5%, 250 mW, 1206 [3216 Metric], Thick Film", "4.7k"],
    ["2.2K Ohm 1/4w 1206 Resistor", "2.2K"],
    ["0.5 Ohm 3W Surface Mount Sense Resistor", "0.5R"],
    ["CL31B106KLHNNNE-Samsung-Cap Ceramic 10uF 35V X7R 10% Pad SMD 1206 125°C T/R", "10uF 35V"],
    ["RLTZ-100uF 25V D6.3xL7.8mm SMD Polymer Aluminum Capacitors ROHS", "100uF 25V"],
    ["OVZ101M1CTR-0606-LELON-16V 100uF ±20% SMD,D6.3xL5.9mm Solid Capacitors ROHS", "100uF 16V"],
    ["MWSA0605S-150MT-Sunlord-15uH 3.1A 20% 90mOhm Unshielded Wirewound Power Inductor SMD", "15uH 3.1A"],
  ])("names %s -> %s", (desc, want) => {
    expect(classifyName(desc).name).toBe(want);
  });

  it("never uses the MPN as the name of a passive", () => {
    const r = classifyName("AC0603FR-0747KL-YAGEO-Res Thick Film 0603 47K Ohm 1% 0.1W(1/10W)");
    expect(r.name).not.toContain("AC0603FR");
  });

  it("keeps milli and mega distinct in a shunt value", () => {
    // Lower-case m is milli: this is a 25 milliohm shunt, not 25 megaohm.
    const r = classifyName(
      "HoYLR2512-2W-25mR-1%-Milliohm-2W 25mΩ Patch Current Sensing Resistors ±1% 2512 Shunt Resistors ROHS"
    );
    expect(r.name).toBe("25mR");
  });
});

describe("classifyName — ICs and discretes are named by MPN", () => {
  it.each([
    ["BAV199-Slkor-85V 1.25V 3us 160mA SOT-23 Switching Diodes ROHS", "BAV199"],
    ["SL8552XS8-Slkor-Dual 0.8V/us 2MHz rail-to-rail input,rail-to-rail output 15uV SOP-8 Operational Amplifier ROHS", "SL8552XS8"],
    ["SL9061A-Slkor-SOT-23-5 Operational Amplifier ROHS", "SL9061A"],
    ["SN74AVC8T245PWR-Texas Instruments-1 8 TSSOP-24 Translators, Level Shifters ROHS", "SN74AVC8T245PWR"],
    ["TL431-GOODWORK-36V 37V 100mA Adjustable SOT-23 Voltage Reference ROHS", "TL431"],
    ["SD103CW-JSCJ-20V 600mV@200mA 350mA SOD-123 Schottky Diodes ROHS", "SD103CW"],
    ["PMBT3906-PAKER-40V 200mW 300 200mA PNP SOT-23 Bipolar (BJT) ROHS", "PMBT3906"],
    ["SLSRV05-4-Slkor-6V Unidirectional 5V SOT-23-6 ESD and Surge Protection (TVS/ESD) ROHS", "SLSRV05-4"],
    ["TLV431TFTA-DIODES INC.-VOLT REF, SHUNT, 1.24V, -40 TO 125DEG C", "TLV431TFTA"],
    ["INA213AIDCKR-TEXAS INSTRUMENTS-Current Sense Amplifier, High Side, Low Side, 80 kHz, SC-70, 6 Pins", "INA213AIDCKR"],
    ["ADR01BRZ-REEL7-ANALOG DEVICES-Voltage Reference, 3ppm/°C, 10V, 0.05%, Series - Fixed, NSOIC-8", "ADR01BRZ"],
    ["MAX6071BAUT33+T-Analog Devices-Voltage Reference, Series - Fixed, MAX6071 Series, 3.3V, SOT-23-6", "MAX6071BAUT33"],
    ["ADS1232 24Bit Low Noise AD Analog To Digital Converter Module", "ADS1232"],
  ])("names %s -> %s", (desc, want) => {
    expect(classifyName(desc).name).toBe(want);
  });

  it("keeps a variant suffix that changes which part it is", () => {
    // -3.3 is the regulator's output voltage and -E2 a probe variant:
    // dropping them would merge genuinely different parts under one name.
    expect(classifyName("SL1117-3.3-Slkor-SOT-223-3L Voltage Regulators - Linear").name).toBe(
      "SL1117-3.3"
    );
    expect(classifyName("P100-E2 Test Probe, Spring Retractable Thimble").name).toBe("P100-E2");
    expect(classifyName("ESP32-C3 USB C Type Development board esp32 c3").name).toBe("ESP32-C3");
  });

  it("still strips a vendor token that follows the part number", () => {
    // A pure-letter segment at that position is a vendor, not a variant.
    expect(classifyName("SD103CW-JSCJ-20V 600mV@200mA SOD-123 Schottky Diodes").name).toBe(
      "SD103CW"
    );
  });

  it("strips a reel/packaging suffix from the MPN", () => {
    // -REEL7 and +T are packaging codes, not part of the part number.
    expect(classifyName("ADR01BRZ-REEL7-ANALOG DEVICES-Voltage Reference, 10V").name).toBe(
      "ADR01BRZ"
    );
    expect(classifyName("MAX6071BAUT33+T-Analog Devices-Voltage Reference, 3.3V").name).toBe(
      "MAX6071BAUT33"
    );
  });
});

describe("classifyName — unresolvable descriptions are left intact", () => {
  // When neither a value nor a part number can be read, the description is
  // returned unchanged rather than truncated to a guess. A half-cut label
  // ("FocuSens Ring Terminal") is worse than the full text, which the user
  // can edit down themselves.
  it.each([
    "FocuSens Ring Terminal NTC BMS Temperature Sensor",
    "Some Entirely Unparseable Vendor Blurb Without Structure Here",
  ])("leaves %s intact", (desc) => {
    const r = classifyName(desc);
    expect(r.name).toBe(desc);
    expect(r.confidence).toBe("low");
  });

  it("still reads a part number out of a connector description", () => {
    expect(classifyName("DC Jack-JDH-02").name).toBe("DC Jack-JDH-02");
  });
});

describe("classifyName — output shape", () => {
  it("shortens a description it can resolve", () => {
    const desc =
      "AC0603FR-0733K2L-Yageo-100mW Thick Film Resistors 75V ±100ppm/℃ ±1% 33.2kΩ 0603 Chip Resistor - Surface Mount ROHS";
    const r = classifyName(desc);
    expect(r.name).toBe("33.2k");
  });

  it("keeps names short — the existing inventory median is 9 chars", () => {
    const descs = [
      "AC0603FR-0747KL-YAGEO-Res Thick Film 0603 47K Ohm 1% 0.1W(1/10W) ±100ppm/°C Pad SMD",
      "CL31B106KLHNNNE-Samsung-Cap Ceramic 10uF 35V X7R 10% Pad SMD 1206 125°C T/R",
      "SL9061A-Slkor-SOT-23-5 Operational Amplifier ROHS",
    ];
    for (const d of descs) {
      expect(classifyName(d).name.length).toBeLessThanOrEqual(24);
    }
  });

  it("returns empty for empty input", () => {
    expect(classifyName("").name).toBe("");
    expect(classifyName("   ").name).toBe("");
  });

  it("reports low confidence when it leaves the description intact", () => {
    const r = classifyName("Some Entirely Unparseable Vendor Blurb Without Structure Here");
    expect(r.confidence).toBe("low");
  });

  it("reports high confidence for a clean MPN-led description", () => {
    expect(classifyName("SL9061A-Slkor-SOT-23-5 Operational Amplifier ROHS").confidence).toBe(
      "high"
    );
  });

  it("reports high confidence for a clean passive", () => {
    expect(
      classifyName("CL31B106KLHNNNE-Samsung-Cap Ceramic 10uF 35V X7R 10% Pad SMD 1206").confidence
    ).toBe("high");
  });
});
