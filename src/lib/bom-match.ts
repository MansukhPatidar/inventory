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
