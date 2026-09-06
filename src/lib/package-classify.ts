/**
 * Footprint/package classifier.
 *
 * Reads a supplier part name/description (the long dash-separated strings
 * that come off a Robu/LCSC order paste) and extracts the component's
 * package, snapping it to the inventory's existing package vocabulary so
 * newly-added parts stay searchable and BOM-matchable against what's
 * already in the DB.
 *
 * Two properties matter more than raw recall:
 *
 *   1. Specificity wins. A description containing "SOT-23-5" must not be
 *      classified "SOT-23", and one containing both "SMD" and "1206" is a
 *      1206 — the first regex hit in string order is the wrong answer.
 *      Candidates are therefore scored by match length, not position.
 *
 *   2. A wrong guess is worse than no guess. "SMD", "THT" and "Surface
 *      Mount" are mount styles, not footprints; a bare 4-digit run is
 *      usually an MPN fragment, not a chip size. Those yield an empty
 *      package with `confidence: "low"` so the queue UI can flag the row
 *      for a human instead of writing something unsearchable into the DB.
 *
 * No React or Supabase imports, so it stays trivially unit-testable.
 */

/** Chip sizes we accept as footprints (imperial). Mirrors `CHIP_SIZES` in
 * `bom-match.ts` — deliberately excludes case codes like 0606 that appear
 * inside electrolytic MPNs but are not imperial chip packages. */
const CHIP_SIZES: Record<string, 1> = {
  "0201": 1,
  "0402": 1,
  "0603": 1,
  "0805": 1,
  "1206": 1,
  "1210": 1,
  "1218": 1,
  "2010": 1,
  "2512": 1,
};

export type PackageSource = "explicit" | "mpn" | "none";
export type PackageConfidence = "high" | "low";

export interface PackageGuess {
  /** Canonical package, or "" when nothing trustworthy was found. */
  package: string;
  /** "low" means a human should check it — either nothing was found, or the
   * package was inferred from an MPN fragment rather than stated outright. */
  confidence: PackageConfidence;
  source: PackageSource;
}

/* =========================================================================
   CANONICALIZATION
   ========================================================================= */

/** Values that carry no footprint information at all. */
const EMPTY_PKGS: Record<string, 1> = {
  "": 1,
  "--": 1,
  "-": 1,
  NULL: 1,
  NONE: 1,
  NA: 1,
  "N/A": 1,
  SMD: 1,
  SMT: 1,
  THT: 1,
};

/** Package families that take a hyphen before their pin count / size, so
 * `TO220` and `TO-220` collapse to one value. */
const HYPHENATED_FAMILIES = [
  "TSSOP",
  "SSOP",
  "TQFP",
  "LQFP",
  "QFP",
  "QFN",
  "DFN",
  "SOIC",
  "ESOP",
  "MSOP",
  "SOP",
  "SOT",
  "SOD",
  "TO",
  "DIP",
  "SIP",
  "BGA",
  "TH",
  "SC",
] as const;

/** One-off spellings seen in this inventory that regex rules can't derive. */
const ALIASES: Record<string, string> = {
  // "SO-8" is the older name for a narrow SOIC-8.
  "SO-8": "SOIC-8",
  SO8: "SOIC-8",
  // "N"/"W" prefixes on SOIC mean narrow/wide body, not a distinct footprint.
  "NSOIC-8": "SOIC-8",
  "WSOIC-8": "SOIC-8",
  // There is no SOT-32; it is a persistent typo for SOT-23 across suppliers.
  "SOT-32": "SOT-23",
  MODULE: "Module",
  TOROIDAL: "Toroidal",
};

/**
 * Fold a raw package string into the inventory's canonical spelling:
 * `TO220` -> `TO-220`, `DIP8` -> `DIP-8`, `R2512` -> `2512`, `dip` -> `DIP`,
 * `SO-8` -> `SOIC-8`, `module` -> `Module`. Returns "" for values that name
 * no footprint (`--`, `SMD`, empty).
 *
 * Idempotent: `canonicalPackage(canonicalPackage(x)) === canonicalPackage(x)`.
 */
export function canonicalPackage(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  if (s === "") return "";

  // Collapse internal whitespace before any lookup so "DIP 15mm" and
  // "DIP  15mm" behave alike.
  s = s.replace(/\s+/g, " ");

  const upper = s.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(EMPTY_PKGS, upper)) return "";

  // Dimensional packages (D6.3xL7.8mm, 6.3x5.4, 8x8x4, 10x12.5) are already
  // canonical — normalizing their case or hyphens would corrupt them.
  if (isDimensional(s)) return s;

  if (Object.prototype.hasOwnProperty.call(ALIASES, upper)) {
    return ALIASES[upper];
  }

  // EasyEDA-style dimension tails: "SOT-23-3_L2.9-W1.6" -> "SOT-23-3".
  if (upper.includes("_")) {
    return canonicalPackage(s.split("_")[0]);
  }

  // Chip sizes carried with a component-letter prefix: R2512 -> 2512.
  const chipPrefixed = /^[CRL]([0-9]{4})$/.exec(upper);
  if (chipPrefixed && Object.prototype.hasOwnProperty.call(CHIP_SIZES, chipPrefixed[1])) {
    return chipPrefixed[1];
  }
  if (/^[0-9]{4}$/.test(upper)) return upper;

  // Family + suffix, with the hyphen optional in the source: TO220 -> TO-220,
  // DIP8 -> DIP-8, "DIP 15mm" -> DIP-15mm, TO220FB -> TO-220FB.
  for (const fam of HYPHENATED_FAMILIES) {
    // Match against the original-case string so unit suffixes keep their
    // case: "TH-5mm" must not become "TH-5MM". Only the family name itself
    // is normalized to upper case.
    const re = new RegExp(`^${fam}[\\s-]?(.+)$`, "i");
    const m = re.exec(s);
    if (m) {
      const rest = m[1].replace(/\s+/g, "");
      if (rest === "") break;
      // Upper-case the suffix (TO-220fb -> TO-220FB) but keep dimension
      // units lower-case, matching the existing "TH-5mm" rows.
      return `${fam}-${rest.toUpperCase().replace(/MM\b/g, "mm")}`;
    }
    if (upper === fam) return fam;
  }

  if (Object.prototype.hasOwnProperty.call(ALIASES, upper)) {
    return ALIASES[upper];
  }

  // Anything else (bare "DIP", "SIP", "MB-F", "3296") keeps its shape but
  // gains a consistent case.
  return upper;
}

/** True for dimension-style packages such as `D6.3xL7.8mm`, `6.3x5.4`,
 * `8x8x4`, `10x12.5`, `5x11 DIP`. */
function isDimensional(s: string): boolean {
  return /\d\s*[x×]\s*[A-Z]?\d/i.test(s);
}

/* =========================================================================
   EXTRACTION
   ========================================================================= */

interface Candidate {
  /** Canonical package text. */
  pkg: string;
  /** Length of the raw matched text; longer = more specific, so it wins. */
  specificity: number;
  source: PackageSource;
}

/**
 * Ordered extraction patterns. Each yields zero or more candidates; the
 * most specific candidate across all patterns wins, so pattern order here
 * is documentation rather than precedence.
 */
const EXPLICIT_PATTERNS: RegExp[] = [
  // Dimensional cans: D6.3xL7.8mm, D6.3xL5.9mm, 6.3x5.4, 8x8x4.
  /\bD\d+(?:\.\d+)?\s*[x×]\s*L\d+(?:\.\d+)?\s*(?:MM)?\b/gi,
  // Pin-counted families. The leading (?<![A-Z0-9]) stops us matching the
  // "SOP-24" tail inside "TSSOP-24" as a separate, less specific candidate.
  /(?<![A-Z0-9])(?:TSSOP|SSOP|ESOP|MSOP|SOIC|NSOIC|WSOIC|SOP|SOT|SOD|TQFP|LQFP|QFP|QFN|DFN|BGA|SC|DO|DIP|SIP)[\s-]?\d+(?:-\d+)*\b/gi,
  // TO-92 / TO-220 / TO-252 / TO-220FB. Requires a digit immediately after
  // the optional hyphen so the English word "TO" in "-40 TO 125DEG" can
  // never match.
  /(?<![A-Z0-9])TO-?\d+[A-Z]{0,3}\b/gi,
];

/** Imperial chip sizes appearing as a standalone token: "... 1% 2512 Current
 * Sense ...". A bare 4-digit run elsewhere (ADS1232, MWSA0605S) is an MPN
 * fragment and is rejected by the surrounding word boundaries. */
const CHIP_TOKEN_RE = /(?<![A-Z0-9./-])(\d{4})(?![A-Z0-9./-])/gi;

/** Chip size embedded in a leading MPN, e.g. `AC0603FR-...`, `RC1206JR-...`,
 * `CL31B106...`. Lower confidence than a standalone token. */
const CHIP_IN_MPN_RE = /^[A-Z]{1,4}(\d{4})[A-Z0-9]/i;

function pushCandidate(out: Candidate[], raw: string, source: PackageSource) {
  const pkg = canonicalPackage(raw);
  if (pkg === "") return;
  out.push({ pkg, specificity: raw.replace(/\s+/g, "").length, source });
}

/**
 * Classify the package named in a part name/description.
 *
 * @param name       Supplier part name or description.
 * @param knownPackages Existing inventory package values. A candidate whose
 *   canonical form matches a known value is returned using that value's
 *   exact spelling, so the classifier never introduces a near-duplicate of
 *   a package already in the DB.
 */
export function classifyPackage(
  name: string | null | undefined,
  knownPackages: string[] = []
): PackageGuess {
  const text = String(name ?? "").trim();
  if (text === "") return { package: "", confidence: "low", source: "none" };

  const candidates: Candidate[] = [];

  for (const re of EXPLICIT_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      pushCandidate(candidates, m[0], "explicit");
    }
  }

  CHIP_TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(CHIP_TOKEN_RE)) {
    if (Object.prototype.hasOwnProperty.call(CHIP_SIZES, m[1])) {
      pushCandidate(candidates, m[1], "explicit");
    }
  }

  // Only consult the MPN when the description stated nothing explicit —
  // an MPN fragment is a weaker signal than a stated package.
  if (candidates.length === 0) {
    const mpnMatch = CHIP_IN_MPN_RE.exec(text);
    if (mpnMatch && Object.prototype.hasOwnProperty.call(CHIP_SIZES, mpnMatch[1])) {
      pushCandidate(candidates, mpnMatch[1], "mpn");
    }
  }

  if (candidates.length === 0) {
    // A bare mount style is recognized only to be discarded: it tells us the
    // part is SMD/THT but not its footprint, which is not worth writing.
    return { package: "", confidence: "low", source: "none" };
  }

  // Most specific wins; explicit beats MPN-derived at equal specificity.
  candidates.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    if (a.source !== b.source) return a.source === "explicit" ? -1 : 1;
    return 0;
  });
  const best = candidates[0];

  return {
    package: snapToKnown(best.pkg, knownPackages),
    confidence: best.source === "explicit" ? "high" : "low",
    source: best.source,
  };
}

/** Return the existing inventory spelling of `pkg` when one exists, so the
 * classifier reuses the vocabulary already in the DB instead of adding a
 * near-duplicate. */
function snapToKnown(pkg: string, knownPackages: string[]): string {
  for (const known of knownPackages) {
    if (canonicalPackage(known) === pkg) return known;
  }
  return pkg;
}
