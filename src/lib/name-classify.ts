/**
 * Short-name classifier.
 *
 * Supplier pastes put an entire description in one field — "AC0603FR-0747KL-
 * YAGEO-Res Thick Film 0603 47K Ohm 1% 0.1W(1/10W) ±100ppm/°C Pad SMD T/R
 * Automotive AEC-Q200". The inventory's own convention, visible in the 271
 * hand-curated rows already in the DB, is that `item_name` holds a short
 * searchable label ("47K 1/10W", "UC3845", "Blue LED") and `details` holds
 * the full blob. This derives that label.
 *
 * The naming rule inverts by component type, which is why a type pass comes
 * first:
 *
 *   - Resistors are named by VALUE alone ("4.7k", "330R"). Nobody searches
 *     for a resistor by its Yageo order code, and 49 of the 62 hand-curated
 *     resistor rows omit the wattage, so the MPN and the rating are both
 *     dropped.
 *   - Capacitors and inductors keep the rating that distinguishes them
 *     ("100uF 25V", "15uH 3.1A"), since a value alone under-specifies them,
 *     falling back to the value when no rating is stated.
 *   - ICs and discretes are named by MPN, with vendor and packaging suffixes
 *     stripped: "ADR01BRZ-REEL7-ANALOG DEVICES-..." -> "ADR01BRZ".
 *   - When nothing resolves, the description is returned UNCHANGED. A
 *     truncated guess reads as a real name while being wrong; the full text
 *     is honest and the user can edit it down.
 *
 * Value text is preserved as written rather than round-tripped through a
 * numeric parse, so "4.7k" stays "4.7k" and, critically, a lower-case milli
 * prefix is never folded into an upper-case mega one — 25mR is a shunt, not
 * a 25 megaohm resistor.
 */

export type ComponentType =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "diode"
  | "transistor"
  | "ic"
  | "connector"
  | "module"
  | "unknown";

export type NameConfidence = "high" | "low";

export interface NameGuess {
  /** Short searchable label, or "" for empty input. */
  name: string;
  confidence: NameConfidence;
  type: ComponentType;
}

/* =========================================================================
   COMPONENT TYPE
   ========================================================================= */

/**
 * Ordered type rules. Order matters: "Current Sensing Resistors" must be a
 * resistor before the word "Sensing" suggests a sensor, and an "Operational
 * Amplifier" must be an IC before the word "Amplifier" is read generically.
 */
const TYPE_RULES: Array<[ComponentType, RegExp]> = [
  // Modules and boards first — "ADC Module" is a module, not an IC, and
  // "Development board" is not a bare chip.
  ["module", /\b(module|development board|breakout|dev board|shield)\b/i],
  ["connector", /\b(connector|socket|plug|header|jack|terminal block|jst|receptacle|ffc|fpc)\b/i],
  // Suppliers abbreviate: "Res Thick Film", "Cap Ceramic". Those forms are
  // matched explicitly rather than by a loose 3-letter prefix, which would
  // also hit words like "Reset" and "Capacity".
  ["resistor", /\b(resistors?|shunt|res\s+thick|res\s+thin|chip\s+resistor)\b/i],
  ["capacitor", /\b(capacitors?|mlcc|multilayer\s+ceramic|cap\s+ceramic|cap\s+alum|ceramic\s+cap)\b/i],
  ["inductor", /\b(inductors?|ferrite beads?|choke|toroid)\b/i],
  ["transistor", /\b(bipolar|bjt|mosfet|transistor|n-channel|p-channel|igbt)\b/i],
  ["diode", /\b(diodes?|rectifier|tvs|esd|zener|schottky|led)\b/i],
  [
    "ic",
    /\b(amplifier|op-?amp|regulator|controller|converter|reference|translators?|level shifters?|driver|microcontroller|mcu|logic|gate|comparator|oscillator|transceiver|adc|dac|opto)\b/i,
  ],
];

/** Classify the component type named in a description. */
export function componentType(desc: string | null | undefined): ComponentType {
  const s = String(desc ?? "");
  if (s.trim() === "") return "unknown";
  for (const [type, re] of TYPE_RULES) {
    if (re.test(s)) return type;
  }
  return "unknown";
}

const PASSIVE_TYPES: Record<string, 1> = { resistor: 1, capacitor: 1, inductor: 1 };

/* =========================================================================
   VALUE EXTRACTION
   ========================================================================= */

/**
 * Resistance written with an explicit unit: "47K Ohm", "4.7 kohm", "33.2kΩ",
 * "25mΩ", "0.5 Ohm", "220 Ohm". The prefix keeps its original case so milli
 * and mega stay distinct.
 */
const RES_VALUE_RE = /(\d+(?:\.\d+)?)\s*(m|k|K|M|meg|R)?\s*(?:Ω|ohms?\b)/i;

/** Resistance in R-notation: "4R7", "10R", "0R22". */
const RES_RNOTE_RE = /\b(\d+)(R)(\d*)\b/;

/** Capacitance: "10uF", "100 uF", "150pF", "100nF", "4.7µF". */
const CAP_VALUE_RE = /(\d+(?:\.\d+)?)\s*(p|n|u|µ|μ|m)\s*F\b/i;

/** Inductance: "15uH", "470uH", "68 µH", "1mH". */
const IND_VALUE_RE = /(\d+(?:\.\d+)?)\s*(p|n|u|µ|μ|m)?\s*H\b(?!z)/i;

/** Voltage rating: "25V", "100 V", "6.3V", "1kV". The largest match wins, so
 * an incidental spec ("1.25V" dropout) loses to the real rating. */
const VOLTAGE_RE = /\b(\d+(?:\.\d+)?)\s*(k)?V\b/gi;


/** Current rating: "3.1A", "500mA", "5 A". */
const CURRENT_RE = /\b(\d+(?:\.\d+)?)\s*(m)?A\b/i;

/** Normalize the micro sign to a plain "u", matching how the existing rows
 * are written ("100uF", not "100µF"). */
function normMicro(s: string): string {
  return s.replace(/[µμ]/g, "u");
}

/** Extract the resistance value as written, e.g. "47K", "4.7k", "25mR",
 * "220R", "0.5R". */
function resistanceText(desc: string): string | null {
  const m = RES_VALUE_RE.exec(desc);
  if (m) {
    const num = m[1];
    const prefixRaw = m[2] || "";
    // Case is meaningful: "m" is milli, "M" is mega. Only "meg" is folded.
    let prefix = prefixRaw;
    if (prefixRaw.toLowerCase() === "meg") prefix = "M";
    if (prefixRaw.toUpperCase() === "R") prefix = "";
    // The prefix alone does not say "resistance", so a milli/bare value
    // keeps an R ("25mR", "220R"); k/M already read as a resistance.
    if (prefix === "" || prefix === "m") return `${num}${prefix}R`;
    return `${num}${prefix}`;
  }
  const r = RES_RNOTE_RE.exec(desc);
  if (r) return r[3] ? `${r[1]}R${r[3]}` : `${r[1]}R`;
  return null;
}

/** Extract the capacitance value as written, e.g. "10uF", "150pF". */
function capacitanceText(desc: string): string | null {
  const m = CAP_VALUE_RE.exec(desc);
  if (!m) return null;
  return normMicro(`${m[1]}${m[2]}F`);
}

/** Extract the inductance value as written, e.g. "15uH", "470uH". */
function inductanceText(desc: string): string | null {
  const m = IND_VALUE_RE.exec(desc);
  if (!m) return null;
  return normMicro(`${m[1]}${m[2] || ""}H`);
}

/** The largest voltage in the description, which for a capacitor is its
 * rating rather than an incidental spec. */
function voltageText(desc: string): string | null {
  VOLTAGE_RE.lastIndex = 0;
  let best: number | null = null;
  let bestText: string | null = null;
  for (const m of desc.matchAll(VOLTAGE_RE)) {
    const kilo = m[2] !== undefined && m[2] !== "";
    const v = parseFloat(m[1]) * (kilo ? 1000 : 1);
    if (best === null || v > best) {
      best = v;
      bestText = kilo ? `${m[1]}kV` : `${m[1]}V`;
    }
  }
  return bestText;
}


/** Current rating as written: "3.1A", "500mA". */
function currentText(desc: string): string | null {
  const m = CURRENT_RE.exec(desc);
  if (!m) return null;
  return `${m[1]}${m[2] ? "m" : ""}A`;
}

/* =========================================================================
   MPN EXTRACTION
   ========================================================================= */

/** Packaging/ordering suffixes that are not part of the part number. */
const PACKAGING_SUFFIX_RE = /[-+](REEL\d*|TR|T|CT|TA|T\/R|TAPE|BULK|REEL7)$/i;

/**
 * True when a token looks like a manufacturer part number rather than a
 * word: it mixes letters and digits and is long enough not to be a spec.
 */
function looksLikeMpn(token: string): boolean {
  if (token.length < 4 || token.length > 28) return false;
  if (!/[A-Z]/i.test(token)) return false;
  if (!/\d/.test(token)) return false;
  // Reject pure spec tokens: 100mA, 3.3V, 0603, 25mΩ, 80kHz.
  if (/^\d+(\.\d+)?\s*(V|A|W|F|H|Hz|R|Ω|mA|mW|uF|nF|pF|uH|mH|ppm|°C|%)$/i.test(token)) {
    return false;
  }
  if (/^\d+(\.\d+)?[A-Z]{1,3}$/i.test(token) && token.length <= 6) return false;
  return true;
}

/**
 * Pull the part number out of a supplier description. These are almost
 * always dash-separated with the MPN first ("SL9061A-Slkor-SOT-23-5 ..."),
 * so the leading token is tried before anything else.
 */
function extractMpn(desc: string): string | null {
  const trimmed = desc.trim();

  // The leading run up to the first delimiter is the usual MPN position.
  // Split on the first "-" only when what follows looks like a vendor name
  // rather than a continuation of the part number (SLSRV05-4 keeps its -4).
  const firstSpace = trimmed.search(/[\s,]/);
  const head = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);

  // "CP2102(6-pin)" -> "CP2102": a bracket never starts a part number.
  let candidate = head.replace(/[([{].*$/, "");
  // "MAX6071BAUT33+T" -> drop the packaging suffix.
  candidate = candidate.replace(/\+[A-Z0-9]{1,4}$/i, "");
  // "MCP1700T-3302E/TT" -> drop an ordering suffix after a slash.
  candidate = candidate.replace(/\/.*$/, "");

  // Hyphenated head: decide how much of it is the part number.
  if (candidate.includes("-")) {
    const segs = candidate.split("-");
    const kept = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i];
      // A short numeric segment is part of the MPN (SLSRV05-4, TL431-1).
      if (/^\d{1,2}$/.test(seg)) {
        kept.push(seg);
        continue;
      }
      // A decimal segment is a voltage/value variant, not a vendor:
      // SL1117-3.3 and SL1117-5.0 are different regulators.
      if (/^\d+\.\d+$/.test(seg)) {
        kept.push(seg);
        continue;
      }
      // A short alphanumeric segment that carries a digit is a variant code
      // (P100-E2, ESP32-C3). A pure-letter segment at this position is a
      // vendor or packaging token (-Slkor, -YAGEO, -REEL7) and ends the MPN.
      if (seg.length <= 4 && /[A-Z]/i.test(seg) && /\d/.test(seg)) {
        kept.push(seg);
        continue;
      }
      break;
    }
    candidate = kept.join("-");
  }

  candidate = candidate.replace(PACKAGING_SUFFIX_RE, "");

  if (looksLikeMpn(candidate)) return candidate;
  return null;
}

/* =========================================================================
   CLASSIFICATION
   ========================================================================= */

/** Join the parts of a name, dropping any that are missing. */
function join(...parts: Array<string | null>): string {
  return parts.filter((p): p is string => p !== null && p !== "").join(" ");
}

/**
 * Derive a short, searchable `item_name` from a supplier description.
 *
 * @param desc Full supplier part description.
 */
export function classifyName(desc: string | null | undefined): NameGuess {
  const text = String(desc ?? "").trim();
  if (text === "") return { name: "", confidence: "low", type: "unknown" };

  const type = componentType(text);

  // --- Passives: value + key rating, never the MPN. ---
  if (Object.prototype.hasOwnProperty.call(PASSIVE_TYPES, type)) {
    if (type === "resistor") {
      // Value only — see the convention note above.
      const value = resistanceText(text);
      if (value) return { name: value, confidence: "high", type };
    }
    if (type === "capacitor") {
      const value = capacitanceText(text);
      if (value) return { name: join(value, voltageText(text)), confidence: "high", type };
    }
    if (type === "inductor") {
      const value = inductanceText(text);
      if (value) return { name: join(value, currentText(text)), confidence: "high", type };
    }
    // A passive whose value we could not read still beats a raw blob if it
    // has an MPN, but it is worth flagging.
    const mpn = extractMpn(text);
    if (mpn) return { name: mpn, confidence: "low", type };
  }

  // --- ICs, discretes and modules: the part number. ---
  const mpn = extractMpn(text);
  if (mpn) {
    const confidence: NameConfidence =
      type === "unknown" || type === "connector" ? "low" : "high";
    return { name: mpn, confidence, type };
  }

  // --- Nothing resolved: hand back the description untouched. ---
  return { name: text, confidence: "low", type };
}

