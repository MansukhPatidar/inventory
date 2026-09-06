/**
 * BOM file parsing — decoding, delimiter sniffing, and column mapping.
 *
 * Ported from the standalone BOM ⇄ Inventory Reconciler
 * (`BOM Analyzer/index.html`). Logic is unchanged from that verified
 * implementation; only the types and module shape are new.
 */

/** One parsed BOM data row, with columns mapped by header name. */
export interface BomLine {
  /** 1-based row index within the parsed data rows (not the "No." column). */
  no: number;
  quantity: string;
  comment: string;
  designator: string;
  footprint: string;
  value: string;
  mpn: string;
  manufacturer: string;
  supplierPart: string;
  supplier: string;
}

export interface ParsedBom {
  header: string[];
  rows: BomLine[];
  colMap: Partial<Record<ColumnKey, number>>;
}

/**
 * Decode a BOM file's raw bytes to text. Sniffs a UTF-16 LE/BE byte-order
 * mark and falls back to UTF-8 (with or without a BOM) otherwise.
 */
export function decodeBomBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Sniff whether the header line uses tabs or commas as the delimiter. */
function sniffDelimiter(headerLine: string): string {
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  return tabCount >= commaCount ? "\t" : ",";
}

/** Parse a full delimited-text blob into an array of row-arrays, respecting quotes. */
function parseDelimited(text: string, delim: string): string[][] {
  let rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === delim) {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
  }
  // flush last field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty trailing rows
  rows = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  return rows;
}

type ColumnKey =
  | "quantity"
  | "comment"
  | "designator"
  | "footprint"
  | "value"
  | "mpn"
  | "manufacturer"
  | "supplierPart"
  | "supplier";

// Column-name matching, case-insensitive & whitespace tolerant.
const COLUMN_ALIASES: Record<ColumnKey, string[]> = {
  quantity: ["quantity", "qty"],
  comment: ["comment", "description"],
  designator: ["designator", "designators", "refdes", "reference"],
  footprint: ["footprint", "package"],
  value: ["value"],
  mpn: ["manufacturer part", "manufacturer part number", "mpn", "mfr part"],
  manufacturer: ["manufacturer", "mfr"],
  supplierPart: ["supplier part", "supplier part number", "lcsc", "lcsc part"],
  supplier: ["supplier"],
};

function normalizeHeaderName(h: string): string {
  return (h || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildColumnMap(headerRow: string[]): Partial<Record<ColumnKey, number>> {
  const normalized = headerRow.map(normalizeHeaderName);
  const map: Partial<Record<ColumnKey, number>> = {};
  (Object.keys(COLUMN_ALIASES) as ColumnKey[]).forEach((key) => {
    const aliases = COLUMN_ALIASES[key];
    for (let i = 0; i < normalized.length; i++) {
      if (aliases.indexOf(normalized[i]) !== -1) {
        map[key] = i;
        break;
      }
    }
  });
  return map;
}

function colValue(cols: string[], colMap: Partial<Record<ColumnKey, number>>, key: ColumnKey): string {
  const idx = colMap[key];
  return idx !== undefined ? (cols[idx] || "").trim() : "";
}

/**
 * Parse decoded BOM text (CSV or TSV, comma- or tab-delimited — sniffed from
 * the header line) into data rows mapped by known column names. Tolerates
 * any subset of the expected columns being present or named differently.
 */
export function parseBom(text: string): BomLine[] {
  return parseBomFull(text).rows;
}

/** Full parse result including the raw header and detected column map. */
export function parseBomFull(text: string): ParsedBom {
  const lines = text.split(/\r\n|\n|\r/);
  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "") {
      firstNonEmpty = i;
      break;
    }
  }
  if (firstNonEmpty === -1) return { header: [], rows: [], colMap: {} };

  const headerLine = lines[firstNonEmpty];
  const delim = sniffDelimiter(headerLine);
  const body = lines.slice(firstNonEmpty).join("\n");
  const table = parseDelimited(body, delim);
  if (table.length === 0) return { header: [], rows: [], colMap: {} };

  const header = table[0];
  const colMap = buildColumnMap(header);
  const rows: BomLine[] = [];

  for (let r = 1; r < table.length; r++) {
    const cols = table[r];
    if (cols.length === 1 && cols[0].trim() === "") continue;

    const rec: BomLine = {
      no: r,
      quantity: colValue(cols, colMap, "quantity"),
      comment: colValue(cols, colMap, "comment"),
      designator: colValue(cols, colMap, "designator"),
      footprint: colValue(cols, colMap, "footprint"),
      value: colValue(cols, colMap, "value"),
      mpn: colValue(cols, colMap, "mpn"),
      manufacturer: colValue(cols, colMap, "manufacturer"),
      supplierPart: colValue(cols, colMap, "supplierPart"),
      supplier: colValue(cols, colMap, "supplier"),
    };

    const allEmpty = (Object.keys(rec) as (keyof BomLine)[]).every(
      (k) => k === "no" || rec[k] === ""
    );
    if (allEmpty) continue;
    rows.push(rec);
  }

  return { header, rows, colMap };
}
