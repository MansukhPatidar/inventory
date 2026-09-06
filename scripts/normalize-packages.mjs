#!/usr/bin/env node
/**
 * One-time cleanup: folds the `parts.package` column into the canonical
 * spellings produced by `src/lib/package-classify.ts`, so that the values
 * the classifier now writes for new parts match the values already in the
 * DB (TO220/TO-220, DIP8/DIP-8/dip, SOP4/SOP-4, R2512/2512, module/Module
 * were all separate values before this ran).
 *
 * Run with tsx, since it imports canonicalPackage from the TypeScript
 * classifier rather than keeping a second copy of those rules in sync.
 *
 * Dry run by default — prints every proposed change and writes nothing:
 *   npx tsx scripts/normalize-packages.mjs
 *
 * Apply, after reviewing that output:
 *   npx tsx scripts/normalize-packages.mjs --apply
 *
 * The `parts` table is shared with another project, so this only ever
 * PATCHes the `package` column of rows whose canonical form differs from
 * what is stored, one row at a time, and never touches any other column.
 *
 * Credentials come from the environment, falling back to .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPackage, classifyPackage } from "../src/lib/package-classify.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = { apply: false, table: "parts", backup: "data/package-backup.json" };
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

async function fetchPage(baseUrl, key, table, from, to) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=id,item_code,item_name,package&order=id.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Range: `${from}-${to}`,
      "Range-Unit": "items",
    },
  });
  if (!res.ok) {
    throw new Error(
      `GET ${table} ${from}-${to} failed: ${res.status} ${res.statusText}\n${await res.text()}`,
    );
  }
  return res.json();
}

async function patchPackage(baseUrl, key, table, id, value) {
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ package: value }),
  });
  if (!res.ok) {
    throw new Error(
      `PATCH id=${id} failed: ${res.status} ${res.statusText}\n${await res.text()}`,
    );
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

  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(baseUrl, key, table, offset, offset + PAGE_SIZE - 1);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  console.log(`read ${rows.length} rows from ${table}\n`);

  const changes = [];
  for (const row of rows) {
    const before = row.package;
    // Leave NULL alone: an absent package and an empty one mean the same
    // thing, and rewriting NULL to "" would churn rows for no gain.
    if (before === null || before === undefined) continue;
    let after = canonicalPackage(before);
    let recovered = false;
    // A stored "SMD" names a mount style, not a footprint, so canonicalizing
    // it empties the field. Before settling for that, check whether the part
    // name states a real package ("... 1206 CCTC ...", "... TO-252 ...") —
    // recovering it is strictly better than dropping to blank.
    if (after === "") {
      const guess = classifyPackage(row.item_name || "");
      if (guess.confidence === "high" && guess.package !== "") {
        after = guess.package;
        recovered = true;
      }
    }
    if (after === before) continue;
    changes.push({
      id: row.id,
      item_code: row.item_code,
      item_name: row.item_name,
      before,
      after,
      recovered,
    });
  }

  if (changes.length === 0) {
    console.log("nothing to change — every package is already canonical");
    return;
  }

  // Group by the before -> after pair so the review reads as a vocabulary
  // diff rather than 300 near-identical lines.
  const groups = new Map();
  for (const c of changes) {
    const k = `${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  const emptied = [];
  const recoveredRows = [];
  for (const [pair, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(items.length).padStart(3)}x  ${pair}`);
    for (const it of items) {
      const tag = it.recovered ? " [read from name]" : "";
      console.log(`        #${it.item_code} ${String(it.item_name).slice(0, 58)}${tag}`);
      if (it.after === "") emptied.push(it);
      if (it.recovered) recoveredRows.push(it);
    }
  }

  console.log(`\n${changes.length} of ${rows.length} rows would change`);
  if (recoveredRows.length > 0) {
    console.log(
      `${recoveredRows.length} gained a real footprint read out of the part name`,
    );
  }
  if (emptied.length > 0) {
    console.log(
      `${emptied.length} lose their package entirely (it named a mount style, not a footprint)`,
    );
  }

  if (!apply) {
    console.log("\ndry run — nothing written. Re-run with --apply to write these changes.");
    return;
  }

  // Save the pre-change values so the edit can be reversed without a
  // separate DB backup.
  const backupPath = path.resolve(ROOT, backup);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(
    backupPath,
    `${JSON.stringify(changes.map(({ id, before }) => ({ id, package: before })), null, 2)}\n`,
  );
  console.log(`\nwrote rollback data for ${changes.length} rows to ${path.relative(ROOT, backupPath)}`);

  let done = 0;
  for (const c of changes) {
    await patchPackage(baseUrl, key, table, c.id, c.after === "" ? null : c.after);
    done++;
    if (done % 25 === 0 || done === changes.length) {
      console.log(`patched ${done}/${changes.length}`);
    }
  }
  console.log(`\ndone — ${done} rows updated`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
