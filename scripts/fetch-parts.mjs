#!/usr/bin/env node
/**
 * Downloads all rows of the `parts` table from Supabase and writes them
 * to data/part.json.
 *
 * Usage: node scripts/fetch-parts.mjs [--out data/part.json] [--table parts]
 *
 * Credentials come from the environment, falling back to .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const args = { out: "data/part.json", table: "parts" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag !== "--out" && flag !== "--table") {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${flag}`);
    if (flag === "--out") args.out = value;
    else args.table = value;
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
  const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&order=id.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Range: `${from}-${to}`,
      "Range-Unit": "items",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${table} ${from}-${to} failed: ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const { out, table } = parseArgs(process.argv.slice(2));
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
    console.log(`fetched ${rows.length} rows`);
    if (page.length < PAGE_SIZE) break;
  }

  const outPath = path.resolve(ROOT, out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`wrote ${rows.length} rows to ${path.relative(ROOT, outPath)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
