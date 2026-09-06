/**
 * Tiered BOM-line-to-inventory-part matcher.
 *
 * Ported from the standalone BOM ⇄ Inventory Reconciler
 * (`BOM Analyzer/index.html`). Matching logic (tier order, thresholds,
 * normalization rules) is unchanged from that verified implementation;
 * only the types and module shape are new. This module has no React or
 * Supabase imports so it stays trivially unit-testable.
 *
 * Quantity is NEVER considered by the matcher and never affects status —
 * inventory quantities are known to be unreliable. `qty` is surfaced on
 * results purely as informational display data.
 */

import type { Part } from "./types";
import type { BomLine } from "./bom-parse";

export type MatchTier = "mpn" | "supplier" | "value+package" | "fuzzy";
export type MatchStatus = "green" | "amber" | "red";

export interface Candidate {
  score: number;
  tier: MatchTier;
  part: Part;
}

export interface ReconciledLine {
  line: BomLine;
  candidates: Candidate[];
  status: MatchStatus;
}

/* =========================================================================
   NORMALIZATION HELPERS
   ========================================================================= */

function normAlnum(s: string | null | undefined): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function tokenizeWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const m = text.match(/[A-Za-z0-9]+/g);
  return m ? m : [];
}

/** Extract candidate MPN-shaped tokens (alnum, mixed letters+digits, length >= 5). */
function mpnCandidates(text: string | null | undefined): string[] {
  if (!text) return [];
  const parts = text.split(/[-/\s]+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = normAlnum(p);
    if (t.length >= 5 && /[0-9]/.test(t) && /[A-Z]/.test(t)) out.push(t);
  }
  return out;
}

function supplierTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return tokenizeWords(text).map((t) => t.toUpperCase());
}

/* ---- Value parsing ---- */

/**
 * SI prefix multipliers.
 *
 * Keyed case-insensitively for every prefix EXCEPT milli/mega, which are the
 * one genuinely ambiguous pair: `M` is mega, `m` is milli, and they differ by
 * a factor of 1e9. Folding them together turns `2.2MΩ` into 2.2 milliohms and
 * `16MHz` into 16 millihertz, which silently destroys matching.
 *
 * Case is therefore preserved for M/m and folded for everything else, since
 * real inventory text is sloppy about case (`100NF`, `4.7uf`, `10K`) and no
 * other prefix collides when folded.
 */
const PREFIX_MULT: Record<string, number> = {
  P: 1e-12,
  N: 1e-9,
  U: 1e-6,
  m: 1e-3,
  M: 1e6,
  K: 1e3,
  G: 1e9,
};

/**
 * Normalize a matched SI prefix for lookup in {@link PREFIX_MULT}: `M`/`m`
 * keep their case so mega and milli stay distinct, every other prefix is
 * upper-cased so sloppy input still resolves. `meg` (any case) means mega.
 */
function prefixKey(raw: string): string {
  if (raw === "") return "";
  if (raw.toUpperCase() === "MEG") return "M";
  if (raw === "M" || raw === "m") return raw;
  return raw.toUpperCase();
}

function cleanValueStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[µμ]/g, "u").replace(/Ω/g, "R").trim();
}

const VAL_RE = /([0-9]+\.?[0-9]*)\s*(p|n|u|m|k|meg|g)?\s*(F|H|Hz|R|Ohm)\b/i;
const EIA_PAREN_RE = /\(([0-9.]+)\s*(pF|nF|uF|F)\)/i;
const RKM_RE = /^([0-9]*)([RrKkMm])([0-9]*)$/;
const VALUE_SCAN_RE =
  /[0-9]+\.?[0-9]*\s*(?:[pnumkgPNUMKG]|meg|MEG)?\s*(?:F|H|Hz|R|Ohm)\b|\([0-9.]+\s*(?:pF|nF|uF|F)\)/gi;
const EIA_BARE_RE = /^([0-9]{3})[A-Za-z]?$/;

export type ValueKind = "farad" | "henry" | "hertz" | "ohm";

export interface ParsedValue {
  qty: number;
  kind: ValueKind;
}

/**
 * Parse a component value string into a unit-normalized quantity. Handles
 * explicit-unit forms (`15pF`, `100nF`, `4.99MΩ`), R/K/M decimal-point
 * resistor shorthand (`4k7`, `4R7`), and bare 3-digit EIA codes (`220` -> pF).
 */
export function parseValue(raw: string | null | undefined): ParsedValue | null {
  if (raw === null || raw === undefined) return null;
  const s = cleanValueStr(raw);
  if (s === "") return null;

  // 1) parenthetical explicit unit, e.g. 220J(22pF)
  let m = EIA_PAREN_RE.exec(s);
  if (m) {
    const num = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const prefixChar = unit.length > 1 ? unit[0].toUpperCase() : "";
    const baseUnit = unit[unit.length - 1].toUpperCase();
    const mult =
      prefixChar === "P" || prefixChar === "N" || prefixChar === "U"
        ? PREFIX_MULT[prefixChar]
        : 1;
    const kind: ValueKind = baseUnit === "H" ? "henry" : "farad";
    return { qty: num * mult, kind };
  }

  // 2) generic explicit unit
  m = VAL_RE.exec(s);
  if (m) {
    const num2 = parseFloat(m[1]);
    const prefix = prefixKey(m[2] || "");
    const unitTok = m[3].toUpperCase();
    let mult2 = 1;
    if (Object.prototype.hasOwnProperty.call(PREFIX_MULT, prefix))
      mult2 = PREFIX_MULT[prefix];
    const kindMap: Record<string, ValueKind> = {
      F: "farad",
      H: "henry",
      HZ: "hertz",
      R: "ohm",
      OHM: "ohm",
    };
    const kind2 = kindMap[unitTok];
    if (kind2) return { qty: num2 * mult2, kind: kind2 };
  }

  // 3) R/K/M decimal-point resistor style: 4R7, 4k7, 0R, 2M2
  const sTrim = s.trim();
  m = RKM_RE.exec(sTrim);
  if (m) {
    const multChar = m[2].toUpperCase();
    const intPart = m[1] || "0";
    const fracPart = m[3] || "";
    const numStr = intPart + (fracPart ? "." + fracPart : "");
    const num3 = parseFloat(numStr);
    if (!isNaN(num3)) {
      const multMap: Record<string, number> = { R: 1, K: 1e3, M: 1e6 };
      return { qty: num3 * multMap[multChar], kind: "ohm" };
    }
  }

  // 4) bare EIA 3-digit code, e.g. "220" or "220J" -> pF
  m = EIA_BARE_RE.exec(sTrim.toUpperCase());
  if (m) {
    const code = m[1];
    const significant = parseInt(code.substring(0, 2), 10);
    const multDigit = parseInt(code.substring(2, 3), 10);
    const pf = significant * Math.pow(10, multDigit);
    return { qty: pf * 1e-12, kind: "farad" };
  }

  return null;
}

function valuesClose(a: number, b: number, tol = 0.01): boolean {
  if (a === 0 && b === 0) return true;
  if (a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

/* ---- Package normalization ---- */

const UNKNOWN_PKGS: Record<string, 1> = { "": 1, NULL: 1, NONE: 1, "--": 1, SMD: 1 };

/**
 * Normalize a package/footprint string for comparison, e.g. `C0603` -> `0603`,
 * `SOT-23-3_L2.9-...` -> `SOT-23-3`. Returns null for unknown/empty packages
 * (`null`, `""`, `--`, `SMD`) — callers must treat null as "unknown", not a
 * mismatch.
 */
export function normPackage(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(UNKNOWN_PKGS, s)) return null;
  s = s.split("_")[0];
  const m = /^[CRL]([0-9]{3,4})$/.exec(s);
  if (m) return m[1];
  s = s.replace(/\s+/g, "");
  if (s === "") return null;
  return s;
}

/* ---- Fuzzy tokens ---- */

const NOISE_TOKENS: Record<string, 1> = {
  ROHS: 1,
  SMD: 1,
  CHIP: 1,
  SURFACE: 1,
  MOUNT: 1,
  THICK: 1,
  FILM: 1,
  RESISTORS: 1,
  RESISTOR: 1,
  CAPACITOR: 1,
  CAPACITORS: 1,
  MULTILAYER: 1,
  CERAMIC: 1,
  MLCC: 1,
  THE: 1,
  AND: 1,
  FOR: 1,
  WITH: 1,
};

function fuzzyTokens(text: string | null | undefined): Record<string, 1> {
  if (!text) return {};
  const toks = tokenizeWords(text.toUpperCase());
  const set: Record<string, 1> = {};
  for (const t of toks) {
    if (t.length >= 2 && !Object.prototype.hasOwnProperty.call(NOISE_TOKENS, t))
      set[t] = 1;
  }
  return set;
}

function setSize(set: Record<string, 1>): number {
  return Object.keys(set).length;
}

function diceCoeff(a: Record<string, 1>, b: Record<string, 1>): number {
  const sizeA = setSize(a);
  const sizeB = setSize(b);
  if (sizeA === 0 || sizeB === 0) return 0;
  let inter = 0;
  for (const k in a) {
    if (Object.prototype.hasOwnProperty.call(b, k)) inter++;
  }
  return (2 * inter) / (sizeA + sizeB);
}

/* =========================================================================
   INVENTORY INDEX
   ========================================================================= */

interface InventoryEntry {
  part: Part;
  text: string;
  cleanText: string;
  mpnSet: Record<string, 1>;
  mpnList: string[];
  supSet: Record<string, 1>;
  pkg: string | null;
  ftoks: Record<string, 1>;
}

function buildInventoryIndex(parts: Part[]): InventoryEntry[] {
  return parts.map((p) => {
    const text = [p.item_name, p.details]
      .filter((v): v is string => v !== null && v !== undefined)
      .join(" ");
    const mpnCandArr = mpnCandidates(text);
    const mpnSet: Record<string, 1> = {};
    mpnCandArr.forEach((c) => {
      mpnSet[c] = 1;
    });
    const supArr = supplierTokens(text);
    const supSet: Record<string, 1> = {};
    supArr.forEach((t) => {
      supSet[t] = 1;
    });
    return {
      part: p,
      text,
      cleanText: cleanValueStr(text),
      mpnSet,
      mpnList: mpnCandArr,
      supSet,
      pkg: normPackage(p.package),
      ftoks: fuzzyTokens(text),
    };
  });
}

/* =========================================================================
   MATCHING
   ========================================================================= */

function matchLine(bomRec: BomLine, invIndex: InventoryEntry[]): Candidate[] {
  const candidates: Candidate[] = [];

  const mpnRaw = bomRec.mpn || "";
  const supplierRaw = bomRec.supplierPart || "";
  const valueRaw = bomRec.value || "";
  const commentRaw = bomRec.comment || "";
  const footprintRaw = bomRec.footprint || "";

  const bomMpnNorm = mpnRaw ? normAlnum(mpnRaw) : "";
  const bomVal = valueRaw ? parseValue(valueRaw) : null;
  const bomPkg = footprintRaw ? normPackage(footprintRaw) : null;
  const bomFtoks = fuzzyTokens(commentRaw);
  const mpnFtoks = fuzzyTokens(mpnRaw);
  for (const k in mpnFtoks) bomFtoks[k] = 1;

  for (const entry of invIndex) {
    let bestTier: MatchTier | null = null;
    let bestScore = 0;

    // Tier 1: MPN
    if (bomMpnNorm && bomMpnNorm.length >= 4) {
      let hit = false;
      if (Object.prototype.hasOwnProperty.call(entry.mpnSet, bomMpnNorm)) hit = true;
      if (!hit && bomMpnNorm.length >= 7) {
        for (const cand of entry.mpnList) {
          if (
            cand.length >= 7 &&
            (cand.indexOf(bomMpnNorm) !== -1 || bomMpnNorm.indexOf(cand) !== -1)
          ) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        bestTier = "mpn";
        bestScore = 1.0;
      }
    }

    // Tier 2: supplier part (whole-token match — never a substring, so
    // "C15" must never match an entry containing "C1591").
    if (!bestTier && supplierRaw && supplierRaw.length >= 3) {
      const supNorm = supplierRaw.toUpperCase().trim();
      if (Object.prototype.hasOwnProperty.call(entry.supSet, supNorm)) {
        bestTier = "supplier";
        bestScore = 0.95;
      }
    }

    // Tier 3: value + package
    if (!bestTier && bomVal) {
      const invText = entry.cleanText;
      let foundValMatch = false;
      VALUE_SCAN_RE.lastIndex = 0;
      let m2: RegExpExecArray | null;
      while ((m2 = VALUE_SCAN_RE.exec(invText)) !== null) {
        const seg = m2[0];
        const pv = parseValue(seg);
        if (pv && pv.kind === bomVal.kind && valuesClose(pv.qty, bomVal.qty)) {
          foundValMatch = true;
          break;
        }
        if (m2[0].length === 0) VALUE_SCAN_RE.lastIndex++;
      }
      if (foundValMatch) {
        let pkgScore = 0;
        let blocked = false;
        if (bomPkg && entry.pkg) {
          if (bomPkg === entry.pkg) pkgScore = 1.0;
          else blocked = true;
        } else if (bomPkg && !entry.pkg) {
          pkgScore = 0.5;
        } else {
          pkgScore = 0.3;
        }
        if (!blocked) {
          bestTier = "value+package";
          bestScore = 0.6 + 0.3 * pkgScore;
        }
      }
    }

    // Tier 4: fuzzy
    if (!bestTier) {
      const sim = diceCoeff(bomFtoks, entry.ftoks);
      if (sim >= 0.35) {
        bestTier = "fuzzy";
        bestScore = sim;
      }
    }

    if (bestTier) candidates.push({ score: bestScore, tier: bestTier, part: entry.part });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

/** Roll up the top candidate's tier into a status. Tiers 1-3 => green, fuzzy-only => amber, none => red. */
function statusForCandidates(candidates: Candidate[]): MatchStatus {
  if (!candidates || candidates.length === 0) return "red";
  const topTier = candidates[0].tier;
  if (topTier === "mpn" || topTier === "supplier" || topTier === "value+package")
    return "green";
  return "amber";
}

/**
 * Match every BOM line against the given parts, returning up to 5 ranked
 * candidates per line and a rolled-up status. Pure function: no React, no
 * Supabase, no globals. Quantity is never consulted — it plays no role in
 * matching or status, only informational display downstream.
 */
export function reconcile(lines: BomLine[], parts: Part[]): ReconciledLine[] {
  const invIndex = buildInventoryIndex(parts);
  return lines.map((line) => {
    const candidates = matchLine(line, invIndex);
    const status = statusForCandidates(candidates);
    return { line, candidates, status };
  });
}

/* =========================================================================
   RELAXED MATCHING (red lines only)

   A `red` line has no candidate in any strict tier. This pass looks for
   near-miss inventory parts to suggest as manual "order" vs "substitute"
   decisions. It never runs for green/amber lines and never feeds back into
   `reconcile`/`matchLine`/`statusForCandidates` — the strict 45/0/35 split
   on the real BOM is unaffected by construction.
   ========================================================================= */

export type RelaxedReason =
  | "exact-value-other-package"
  | "near-value-same-package"
  | "near-value-other-package";

export interface RelaxedCandidate {
  part: Part;
  reason: RelaxedReason;
  score: number;
  crossFamily: boolean;
}

/** Coarse package-compatibility family. Suggestions only cross into a
 * different pkg within the same family by default; cross-family hits are
 * still surfaced but ranked last and flagged. */
export type PackageFamily =
  | "chip"
  | "smd-can"
  | "through-hole"
  | "sot"
  | "sop"
  | "unknown";

const CHIP_SIZES: Record<string, 1> = {
  "0201": 1,
  "0402": 1,
  "0603": 1,
  "0805": 1,
  "1206": 1,
  "1210": 1,
  "2010": 1,
  "2512": 1,
};

/**
 * Classify a normalized-or-raw package string into a coarse family so
 * relaxed suggestions don't silently cross between, say, a 0603 chip
 * resistor and a through-hole radial capacitor.
 */
export function packageFamily(pkg: string | null | undefined): PackageFamily {
  if (!pkg) return "unknown";
  const s = String(pkg).trim().toUpperCase();
  if (s === "") return "unknown";

  // Try the normalized chip-size form first (normPackage already strips
  // C/R/L prefixes and _-suffixed dimension tails).
  const norm = normPackage(s);
  if (norm && Object.prototype.hasOwnProperty.call(CHIP_SIZES, norm)) return "chip";

  // EasyEDA footprints carry the chip size in a dimension tail that
  // normPackage discards at the first underscore, e.g.
  // "RES-SMD_L6.4-W3.2-R2512" -> "RES-SMD". Recover it so a 2512 shunt is
  // recognised as the same family as a 2512 chip resistor rather than
  // falling through to "unknown" and being labelled a cross-family guess.
  const embedded = /[-_]([CRL]?)(\d{4})\b/.exec(s);
  if (
    embedded &&
    Object.prototype.hasOwnProperty.call(CHIP_SIZES, embedded[2])
  ) {
    return "chip";
  }

  if (/^SOT[-_]?\d/.test(s)) return "sot";
  if (/^(SOP|SOIC|TSSOP|ESSOP|QFN|LQFP)/.test(s)) return "sop";
  if (/^(DIP|TO-?92|TH-|HDR-TH)/.test(s)) return "through-hole";
  if (/^(CAP-SMD|D\d+X)/.test(s)) return "smd-can";
  if (/^D\d/.test(s)) return "smd-can"; // e.g. "D8.0xL10.0"
  if (/RADIAL/.test(s)) return "through-hole";

  return "unknown";
}

/**
 * E12 preferred-value significands (1.0-8.2 decade), used to detect
 * "adjacent E-series neighbour" values for the near-value band, e.g. 33k is
 * adjacent to 27k and 39k.
 */
const E12_SIGNIFICANDS = [
  1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2,
];

/**
 * Build the full E12 preferred-value sequence (as absolute values, not just
 * significands) spanning several decades either side of a reference value,
 * so adjacency can be checked without collapsing magnitude information —
 * comparing bare significands would wrongly call 5 and 4700 "adjacent"
 * because both round to a ~4.7-5 significand.
 */
function e12Neighbours(v: number): number[] {
  const decade = Math.pow(10, Math.floor(Math.log10(v)));
  const out: number[] = [];
  // The decade above and below in case v's significand rounds near a
  // boundary (e.g. just under 1.0 or just over 8.2).
  for (const mult of [decade / 10, decade, decade * 10]) {
    for (const sig of E12_SIGNIFICANDS) out.push(sig * mult);
  }
  return out;
}

/** True when `b` is within the widened near-value band of `a`: ~±20%, or an
 * adjacent E12 neighbour (whichever is more permissive). Both checks are
 * magnitude-aware — they never treat values in different decades as near. */
function valuesNear(a: number, b: number): boolean {
  if (a === 0 || b === 0) return a === b;
  const ratio = b / a;
  if (ratio >= 0.8 && ratio <= 1.2) return true;

  // Adjacent E-series neighbour check: find a's position in its own E12
  // sequence (spanning the decade above/below) and see whether b matches
  // one of the immediately adjacent entries.
  const seq = e12Neighbours(a).sort((x, y) => x - y);
  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < seq.length; i++) {
    const d = Math.abs(Math.log(seq[i]) - Math.log(a));
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }
  for (const i of [closestIdx - 1, closestIdx, closestIdx + 1]) {
    if (i < 0 || i >= seq.length) continue;
    const neighbour = seq[i];
    if (Math.abs(neighbour - b) / Math.max(neighbour, b) <= 0.05) return true;
  }
  return false;
}

/** Value-bearing BOM lines look like passives; MPN-shaped tokens with no
 * parsable value look like semiconductors/ICs, where we must never guess an
 * "equivalent" part. */
function looksLikeSemiconductor(line: BomLine): boolean {
  const val = line.value ? parseValue(line.value) : null;
  if (val) return false;
  // No parsable value anywhere (value column, or embedded in comment) and an
  // MPN-shaped token present -> treat as a semiconductor/IC line.
  const commentVal = line.comment ? parseValue(line.comment) : null;
  if (commentVal) return false;
  const mpnLike = mpnCandidates(line.mpn || line.comment || "");
  return mpnLike.length > 0;
}

/**
 * Marker words that mean a number in an inventory row is a *spec* of some
 * active or frequency-dependent part, not that part's own value.
 *
 * A MOSFET's on-resistance ("120mΩ@4.5V"), an inductor's DC resistance
 * ("90mOhm"), and a ferrite bead's impedance ("100Ω@100MHz") all scan as
 * plain ohm readings, so without this an IRFP9540 gets offered as a
 * substitute for a 100mΩ current-shunt resistor. They are not
 * interchangeable, and a confident wrong suggestion at the bench is worse
 * than no suggestion at all.
 */
const SPEC_NOT_VALUE_RE =
  /\bMOSFET\b|\bIGBT\b|\btransistor\b|\bdiode\b|\bferrite\b|\bbead\b|\binductor\b|\brelay\b|\bregulator\b|\bamplifier\b|\bRDS\b|\bDCR\b|@\s*\d|\bV\s*,\s*\d|\bA\b\s*\d+m[ΩR]/i;

/**
 * True when an inventory row's ohm/farad/henry reading is really a spec of
 * an active part rather than the value of a passive. Only consulted for
 * relaxed matching; the strict tiers are untouched.
 */
function inventoryValueIsSpec(part: Part, kind: ValueKind): boolean {
  const text = [part.item_name, part.details].filter(Boolean).join(" ");
  // Ferrite beads are rated in ohms at a frequency but are not resistors.
  if (kind === "ohm" && /ferrite|bead/i.test(text)) return true;
  return SPEC_NOT_VALUE_RE.test(text);
}

/**
 * For a single `red` reconciled line, search the full inventory for
 * near-miss passive-component candidates: same value in a different
 * package, or a nearby value in the same (or a different) package. Returns
 * up to 8 candidates, strongest first. Returns an empty array for lines
 * that look like semiconductors/ICs (no parsable value) — we never guess
 * part-number equivalence there.
 *
 * The same suppression applies in the other direction: an inventory row
 * whose ohm reading is an on-resistance or impedance spec is skipped, so
 * active parts are never offered as passive substitutes.
 *
 * Pure and read-only: does not mutate `line` or `parts`, and is never
 * invoked from `reconcile` — callers run it only for lines whose `status`
 * came back `"red"`.
 */
export function findRelaxedCandidates(
  redLine: ReconciledLine,
  parts: Part[]
): RelaxedCandidate[] {
  const line = redLine.line;
  if (redLine.status !== "red") return [];

  const bomVal = line.value ? parseValue(line.value) : null;
  const bomValFromComment = !bomVal && line.comment ? parseValue(line.comment) : null;
  const effectiveVal = bomVal || bomValFromComment;

  if (!effectiveVal) return []; // no parsable value: never guess at ICs/semis
  if (looksLikeSemiconductor(line)) return [];

  const bomPkg = line.footprint ? normPackage(line.footprint) : null;
  const bomFamily = packageFamily(line.footprint);

  const out: RelaxedCandidate[] = [];

  for (const p of parts) {
    // Skip rows whose value reading is really an active part's spec (a
    // MOSFET's on-resistance, a bead's impedance) rather than its value.
    if (inventoryValueIsSpec(p, effectiveVal.kind)) continue;

    const text = [p.item_name, p.details]
      .filter((v): v is string => v !== null && v !== undefined)
      .join(" ");
    const cleanText = cleanValueStr(text);

    // Find the best value match embedded anywhere in this part's text.
    let bestKindMatch: ParsedValue | null = null;
    let exact = false;
    VALUE_SCAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VALUE_SCAN_RE.exec(cleanText)) !== null) {
      // Dielectric/temperature-coefficient codes like X5R, X7R, C0G, NP0 are
      // not values, but the trailing digit+letter ("5R", "0G") can look like
      // a bare ohm/farad reading to the generic scanner. Skip a match whose
      // preceding character is a letter that turns it into one of these
      // codes — this guard is local to relaxed matching and never touches
      // the strict tiers' shared scan loop above.
      const precedingChar = cleanText[m.index - 1];
      if (precedingChar && /[A-Za-z]/.test(precedingChar)) {
        if (m[0].length === 0) VALUE_SCAN_RE.lastIndex++;
        continue;
      }
      const pv = parseValue(m[0]);
      if (pv && pv.kind === effectiveVal.kind) {
        const isExact = valuesClose(pv.qty, effectiveVal.qty);
        const isNear = valuesNear(pv.qty, effectiveVal.qty);
        if (isExact) {
          bestKindMatch = pv;
          exact = true;
          break;
        }
        if (isNear && !bestKindMatch) {
          bestKindMatch = pv;
        }
      }
      if (m[0].length === 0) VALUE_SCAN_RE.lastIndex++;
    }

    if (!bestKindMatch) continue;

    const entryPkg = normPackage(p.package);
    const entryFamily = packageFamily(p.package);
    const samePackage = bomPkg !== null && entryPkg !== null && bomPkg === entryPkg;
    const crossFamily = !(bomFamily !== "unknown" && bomFamily === entryFamily);

    let reason: RelaxedReason;
    let score: number;
    if (exact && !samePackage) {
      reason = "exact-value-other-package";
      score = crossFamily ? 0.6 : 0.85;
    } else if (!exact && samePackage) {
      reason = "near-value-same-package";
      score = crossFamily ? 0.5 : 0.7;
    } else if (!exact && !samePackage) {
      reason = "near-value-other-package";
      score = crossFamily ? 0.25 : 0.45;
    } else {
      // exact value, same package: reconcile() would already have made this
      // a green value+package match, so a red line can't legitimately reach
      // here — skip rather than double-report.
      continue;
    }

    out.push({ part: p, reason, score, crossFamily });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 8);
}
