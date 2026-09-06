/**
 * BOM line grouping — merges multiple source BOM lines that represent the
 * same real component into a single grouped row before reconciliation.
 *
 * EasyEDA (and other ECAD tools) sometimes split what is really one component
 * into several BOM lines because the individual instances were placed from
 * slightly different manufacturer part numbers (e.g. two 150pF/C0603
 * capacitors sourced from different MPNs). The user's decision, implemented
 * exactly here:
 *
 *   Group by normalized value + normalized footprint. Value is dominant;
 *   the manufacturer part number is ignored when deciding whether to group.
 *   Grouping is always on — there is no toggle.
 *
 * Value and footprint are compared in *normalized* form (via `parseValue`
 * and `normPackage` from `bom-match.ts`) rather than as raw strings, so
 * `100nF` and `0.1uF` in the same footprint are recognised as the same
 * group. Lines with no parsable value (ICs, connectors, mechanical parts)
 * fall back to grouping by MPN/comment + footprint instead, so distinct
 * chips are never merged — only lines that are genuinely identical on that
 * fallback key are.
 *
 * This module is pure — no React, no Supabase — and independent of
 * bom-match.ts's part-matching concerns, which is why it lives in its own
 * file rather than being folded into bom-match.ts.
 */

import type { BomLine } from "./bom-parse";
import { parseValue, normPackage } from "./bom-match";

export interface GroupedBomLine {
  /** Merged designator string across all member lines, in source order. */
  designator: string;
  /** Summed BOM quantity across all member lines. */
  quantity: number;
  /** Representative comment (first member's). */
  comment: string;
  /** Representative footprint (first member's raw string). */
  footprint: string;
  /** Representative value (first member's raw string). */
  value: string;
  /** Representative manufacturer (first member's). */
  manufacturer: string;
  /** Representative supplier (first member's). */
  supplier: string;
  /** Representative supplier part (first member's). */
  supplierPart: string;
  /** Distinct manufacturer part numbers seen across all member lines, in
   *  first-seen order. Informational only — never a warning or conflict. */
  mpns: string[];
  /** The original member BomLines, unmodified, so nothing from the source
   *  export is lost. */
  members: BomLine[];
  /** Count of source lines merged into this group (members.length). */
  mergedCount: number;
}

/** Parse a BOM quantity field to a number; non-numeric or empty reads as 0. */
function parseQty(q: string | null | undefined): number {
  const n = parseFloat(String(q ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Split a designator list ("R26,R34,R36") into trimmed individual designators. */
function splitDesignators(d: string): string[] {
  return d
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinDesignators(list: string[]): string {
  return list.join(",");
}

/** Normalize a string for use in the no-parsable-value fallback grouping key. */
function normLoose(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Compute the grouping key for one BOM line. Two lines group together iff
 * their keys are `===`.
 *
 * - Footprint is normalized via `normPackage`; an unrecognized/empty
 *   footprint normalizes to `null` for both sides, and null-vs-null is
 *   still treated as "the same footprint" (both lines genuinely don't state
 *   one) — but a stated footprint never merges with an unstated one, since
 *   that would risk merging across parts that are not actually identical.
 * - When the value is parsable, the key is the value's kind + normalized
 *   quantity (rounded to absorb float noise) plus the footprint key. The
 *   MPN is deliberately excluded.
 * - When the value is not parsable, the key falls back to the MPN (or, if
 *   absent, the comment) plus the footprint key, so distinct no-value parts
 *   (different ICs) never merge, while genuinely identical no-value entries
 *   (same MPN/comment, same footprint) do.
 */
function groupKey(line: BomLine): string {
  const fp = normPackage(line.footprint);
  const fpKey = fp === null ? "FP:?" : `FP:${fp}`;

  const parsed = parseValue(line.value) || parseValue(line.comment);
  if (parsed) {
    // Round to a relative precision well below any legitimate distinct
    // component value, so float representation noise never splits a group.
    const roundedQty = Number(parsed.qty.toPrecision(9));
    return `VAL:${parsed.kind}:${roundedQty}|${fpKey}`;
  }

  const fallback = normLoose(line.mpn) || normLoose(line.comment);
  return `NOVAL:${fallback}|${fpKey}`;
}

/**
 * Group BOM lines that represent the same real component per the rule
 * above. Pure function: does not mutate its input, no React, no Supabase.
 * Order of the returned groups follows first appearance in `lines`.
 */
export function groupBomLines(lines: BomLine[]): GroupedBomLine[] {
  const order: string[] = [];
  const groups = new Map<string, BomLine[]>();

  for (const line of lines) {
    const key = groupKey(line);
    const existing = groups.get(key);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(key, [line]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const members = groups.get(key)!;
    const first = members[0];

    const designators: string[] = [];
    for (const m of members) {
      for (const d of splitDesignators(m.designator)) {
        if (!designators.includes(d)) designators.push(d);
      }
    }

    const mpns: string[] = [];
    for (const m of members) {
      const mpn = (m.mpn || "").trim();
      if (mpn && !mpns.includes(mpn)) mpns.push(mpn);
    }

    const quantity = members.reduce((sum, m) => sum + parseQty(m.quantity), 0);

    return {
      designator: joinDesignators(designators),
      quantity,
      comment: first.comment,
      footprint: first.footprint,
      value: first.value,
      manufacturer: first.manufacturer,
      supplier: first.supplier,
      supplierPart: first.supplierPart,
      mpns,
      members,
      mergedCount: members.length,
    };
  });
}

/**
 * Convert a GroupedBomLine back into the BomLine shape `reconcile()` and
 * `findRelaxedCandidates()` expect, so grouping can slot in ahead of the
 * existing matcher without changing its signature. `quantity` is
 * stringified since BomLine.quantity is a display string; `no` is the
 * first member's row number (used only as a stable-ish identifier, never
 * shown as "the" source row since a group can span several).
 */
export function groupedLineToBomLine(g: GroupedBomLine): BomLine {
  const first = g.members[0];
  return {
    no: first.no,
    quantity: String(g.quantity),
    comment: g.comment,
    designator: g.designator,
    footprint: g.footprint,
    value: g.value,
    mpn: g.mpns[0] || first.mpn,
    manufacturer: g.manufacturer,
    supplierPart: g.supplierPart,
    supplier: g.supplier,
  };
}
