// Keyset cursors for the message lists (messages.ts: newest first, the cursor
// points older). A cursor is the (createdAt, id) of the last message on the
// page the app holds, so a page stays the same page while new messages arrive.
//
// A cursor is untrusted input (API_V1.md §4): it is decoded strictly, and it
// only ever narrows the query it is added to, never widens it.
import "server-only";

export interface Keyset {
  at: Date;
  id: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.id }), "utf8").toString("base64url");
}

/** undefined for no cursor, "invalid" for one that isn't ours. */
export function decodeCursor(raw: string | undefined): Keyset | undefined | "invalid" {
  if (raw === undefined || raw === "") return undefined;
  if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return "invalid";
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { t?: unknown; id?: unknown };
    if (typeof parsed.t !== "string" || typeof parsed.id !== "string" || !ID_RE.test(parsed.id)) return "invalid";
    const at = new Date(parsed.t);
    if (Number.isNaN(at.getTime())) return "invalid";
    return { at, id: parsed.id };
  } catch {
    return "invalid";
  }
}

/** The where clause for "older than the cursor", newest-first order. */
export function olderThan(cursor: Keyset | undefined) {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
  };
}

/** Newest first, ties broken by id, matching olderThan. */
export const NEWEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** Take one more than a page to learn whether there is another. */
export function pageOf<T extends { createdAt: Date; id: string }>(
  rows: T[],
  size: number,
): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= size) return { rows, nextCursor: null };
  const kept = rows.slice(0, size);
  return { rows: kept, nextCursor: encodeCursor(kept[kept.length - 1]) };
}
