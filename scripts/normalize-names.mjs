#!/usr/bin/env node
/**
 * One-time cleanup: replaces `item_name` values that still carry a whole
 * supplier description with the short label the name classifier derives, so
 * pasted rows match the convention the hand-curated rows already follow
 * (`item_name` is a searchable label, `details` holds the full blob).
 *
 * This does NOT rewrite every row the classifier could shorten. Rows are
 * opted in explicitly by item_code in ROWS below, each with the exact name
 * to write, because a review of the candidates found the classifier's
 * proposal actively worse for parts that have no real MPN — two banana-jack
 * rows collapsed to the same name, and several FFC connectors lost the pin
 * spec that identifies them. Those were excluded by hand.
 *
 * Run with tsx, since it imports the TypeScript classifier to re-derive and
 * verify each name rather than trusting the list blindly.
 *
 * Dry run by default — prints every proposed change and writes nothing:
 *   npx tsx scripts/normalize-names.mjs
 *
 * Apply, after reviewing that output:
 *   npx tsx scripts/normalize-names.mjs --apply
 *
 * The `parts` table is shared with another project, so this only ever
 * PATCHes the `item_name` column of the listed rows, one at a time, and
 * never touches any other column.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyName } from "../src/lib/name-classify.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Rows to rename, by item_code, with the name each should end up with.
 * Every entry was reviewed individually; see the header for what was
 * deliberately left out.
 */
const ROWS = [
  // --- Clean MPN extraction: the description's leading part number, with
  // vendor and packaging tokens stripped but variant suffixes kept. ---
  { code: 229, name: "P100-E2" },
  { code: 233, name: "CH224K" },
  { code: 242, name: "TP4056" },
  { code: 257, name: "X322516MLB4SI" },
  { code: 280, name: "XY848AK-9.50" },
  { code: 308, name: "SL1117-3.3" },
  { code: 312, name: "CMD150N03A" },
  { code: 350, name: "U221-041N" },
  { code: 374, name: "AQY282SX" },

  // --- Passives named by value, per the convention in the curated rows. ---
  { code: 272, name: "15uH 3.1A" },
  { code: 311, name: "220uF 35V" },
  { code: 318, name: "43k" },
  { code: 322, name: "8.2k" },
  // Applied as "1K 1206": 1K collides with #204, a 1kΩ in a 1210 package,
  // so the collision rule appended the package. Listed in its final form so
  // a re-run recognises the row as already done.
  { code: 341, name: "1K 1206" },
  { code: 369, name: "4.99M" },
  { code: 403, name: "0.5R" },
  { code: 409, name: "100uF 16V" },

  // --- ICs and discretes named by MPN. ---
  { code: 244, name: "CH32V003J4M6" },
  { code: 245, name: "CH32V003A4M6" },
  { code: 260, name: "SN74LS04DR" },
  { code: 261, name: "74LS07" },
  { code: 307, name: "BAV199T-7" },
  { code: 310, name: "AO3401" },

  // Capacitors whose line names no category, only an EIA code and a value.
  { code: 243, name: "100uF 6.3V" },
  { code: 334, name: "100nF 50V" },
  { code: 363, name: "470pF 50V" },

  // Deliberately NOT listed, though the classifier is confident about them:
  //   #138 "ESP32-WROOM-32 WiFi + BT + BLE Module" -> "ESP32" drops the
  //        module variant, and #390 is already "ESP32-C3 SUPER MINI".
  //   #294 "LQFP64 Breakout Board ..." -> "LQFP64" makes a breakout board
  //        read as a bare chip package.
];

function parseArgs(argv) {
  const args = { apply: false, table: "parts", backup: "data/name-backup.json" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === "--apply") {
      args.apply = true;
      continue;
    }
    if (flag !== "--table" && flag !== "--backup") {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === "--table") args.table = value;
    else args.backup = value;
  }
  return args;
}

async function loadEnvLocal() {
  let raw;
  try {
    raw = await readFile(path.join(ROOT, ".env.local"), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    process.env[key] = match[2].trim().replace(/^(['"])(.*)\1$/s, "$2");
  }
}

async function fetchAll(baseUrl, key, table) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=id,item_code,item_name,package&order=id.asc`;
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${table} failed: ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return res.json();
}

async function patchName(baseUrl, key, table, id, value) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ item_name: value }),
  });
  if (!res.ok) {
    throw new Error(`PATCH id=${id} failed: ${res.status} ${res.statusText}\n${await res.text()}`);
  }
}

async function main() {
  const { apply, table, backup } = parseArgs(process.argv.slice(2));
  await loadEnvLocal();

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (env or .env.local)",
    );
  }

  const all = await fetchAll(baseUrl, key, table);
  console.log(`read ${all.length} rows from ${table}\n`);

  const byCode = new Map(all.map((r) => [r.item_code, r]));
  const changes = [];
  const problems = [];

  for (const want of ROWS) {
    const row = byCode.get(want.code);
    if (!row) {
      problems.push(`#${want.code}: no such row — skipped`);
      continue;
    }
    const before = (row.item_name || "").trim();
    if (before === want.name) {
      console.log(`#${want.code} already named ${JSON.stringify(want.name)} — nothing to do`);
      continue;
    }
    // Re-derive from the live value: if the row changed since the review,
    // the listed name may no longer be what the classifier would produce.
    const derived = classifyName(before).name;
    if (derived !== want.name) {
      problems.push(
        `#${want.code}: classifier now yields ${JSON.stringify(derived)}, not the reviewed ` +
          `${JSON.stringify(want.name)} — skipped, re-review this row`,
      );
      continue;
    }
    changes.push({ id: row.id, code: want.code, before, after: want.name });
  }

  // A name that already exists elsewhere would make two parts
  // indistinguishable in search, which is the failure this cleanup exists
  // to avoid. Append the package to disambiguate, and say so.
  for (const c of changes) {
    const clash = all.find(
      (r) => r.id !== c.id && (r.item_name || "").trim().toLowerCase() === c.after.toLowerCase(),
    );
    if (!clash) continue;
    const pkg = byCode.get(c.code)?.package;
    if (pkg) {
      c.after = `${c.after} ${pkg}`;
      c.note = `disambiguated from #${clash.item_code}`;
    } else {
      problems.push(
        `#${c.code}: ${JSON.stringify(c.after)} collides with #${clash.item_code} and has no ` +
          `package to disambiguate — skipped`,
      );
      c.skip = true;
    }
  }
  const applicable = changes.filter((c) => !c.skip);

  for (const c of applicable) {
    console.log(
      `#${String(c.code).padStart(3)}  ${JSON.stringify(c.after)}${c.note ? `  (${c.note})` : ""}`,
    );
    console.log(`      was: ${c.before.slice(0, 72)}`);
  }

  if (problems.length > 0) {
    console.log(`\nnot applied:`);
    for (const p of problems) console.log(`  ${p}`);
  }

  console.log(`\n${applicable.length} rows would change`);

  if (!apply) {
    console.log("\ndry run — nothing written. Re-run with --apply to write these changes.");
    return;
  }
  if (applicable.length === 0) return;

  const backupPath = path.resolve(ROOT, backup);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(
    backupPath,
    `${JSON.stringify(
      applicable.map(({ id, before }) => ({ id, item_name: before })),
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote rollback data for ${applicable.length} rows to ${path.relative(ROOT, backupPath)}`);

  let done = 0;
  for (const c of applicable) {
    await patchName(baseUrl, key, table, c.id, c.after);
    done++;
  }
  console.log(`\ndone — ${done} rows updated`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
