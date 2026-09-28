// Keyset cursors for the manager lists. A cursor is the (time, id) of the last
// row on the page the app holds, plus an optional small rank for lists sorted
// by something before time (issues: urgent first). It is untrusted input
// (API_V1.md §4): decoded strictly, and it only ever narrows the query it is
// added to, never widens it.
import "server-only";

import { failure, type Failure } from "../result";

export interface Keyset {
  at: Date;
  id: string;
  /** A sort rank before the time, when the list has one. */
  r?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const RANK_RE = /^[A-Z_]{1,24}$/;

export function encodeKeyset(k: Keyset): string {
  return Buffer.from(JSON.stringify({ t: k.at.toISOString(), id: k.id, ...(k.r ? { r: k.r } : {}) }), "utf8").toString(
    "base64url",
  );
}

/** undefined for no cursor, "invalid" for one that isn't ours. */
export function decodeKeyset(raw: string | undefined): Keyset | undefined | "invalid" {
  if (raw === undefined || raw === "") return undefined;
  if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return "invalid";
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; id?: unknown; r?: unknown };
    if (typeof p.t !== "string" || typeof p.id !== "string" || !ID_RE.test(p.id)) return "invalid";
    if (p.r !== undefined && (typeof p.r !== "string" || !RANK_RE.test(p.r))) return "invalid";
    const at = new Date(p.t);
    if (Number.isNaN(at.getTime())) return "invalid";
    return { at, id: p.id, ...(typeof p.r === "string" ? { r: p.r } : {}) };
  } catch {
    return "invalid";
  }
}

export const badCursor = (): Failure =>
  failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

/** Rows after the cursor in (field, id) order: "desc" pages older, "asc" newer. */
export function afterKeyset(field: string, dir: "asc" | "desc", k: Keyset | undefined): Record<string, unknown> {
  if (!k) return {};
  const cmp = dir === "desc" ? "lt" : "gt";
  return { OR: [{ [field]: { [cmp]: k.at } }, { [field]: k.at, id: { [cmp]: k.id } }] };
}

/** Take one more than a page to learn whether there is another. */
export function pageBy<T>(rows: T[], size: number, key: (row: T) => Keyset): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= size) return { rows, nextCursor: null };
  const kept = rows.slice(0, size);
  return { rows: kept, nextCursor: encodeKeyset(key(kept[kept.length - 1])) };
}
