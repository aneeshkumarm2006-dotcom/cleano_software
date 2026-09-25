// Append-only record of every database row the browser tests create.
//
// JSONL, not JSON: several test subagents run at once, and appending one
// short line is atomic enough on every platform we care about, whereas
// read-modify-write of a JSON array would lose records under concurrency.
// Cleanup depends on this file being complete — a lost line is a row left
// behind on a live production database.
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BT_DIR = join(HERE, "..");
export const MANIFEST = join(BT_DIR, "manifest.jsonl");

/** Marker embedded in every name/email we create, so a missed manifest line
 *  is still recoverable by a sweep. Must never appear in real data. */
export const MARKER = "BTTEST";

/** Record one created row. Call this IMMEDIATELY after the insert. */
export function record(model, id, by = "unknown") {
  if (!model || !id) throw new Error(`record() needs model and id, got ${model}/${id}`);
  appendFileSync(MANIFEST, JSON.stringify({ model, id, by, at: new Date().toISOString() }) + "\n");
}

/** Every recorded row, de-duplicated on (model, id). */
export function readManifest() {
  if (!existsSync(MANIFEST)) return [];
  const seen = new Set();
  const out = [];
  for (const line of readFileSync(MANIFEST, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch { continue; }   // never let one bad line hide the rest
    const key = `${row.model}::${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
