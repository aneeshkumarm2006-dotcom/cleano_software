// Stops the same alert being written twice while the first copy is still on
// screen (client feedback item 25 — two byte-identical "Assignment unconfirmed"
// rows, same title, same body, same minute).
//
// The key is the alert's full logical identity — type + relatedId + recipient +
// title + message — NOT just (type, relatedId, recipient). That triple is too
// coarse to be safe here: saveJob.ts writes two different GENERAL alerts about
// the same job to the same cleaner (reassignment and schedule change), and
// several jobs carry more than one unconfirmed cleaner. Keying on the triple
// would silently swallow the second of each pair, trading a duplicate-row
// complaint for a missing-alert one. Identical CONTENT is what the client
// reported and identical content is what this suppresses.
//
// Scoped to undismissed rows on purpose: once an admin has cleared an alert, the
// condition recurring is news again and must be allowed to re-raise.
import "server-only";
import { db } from "@/lib/org-db";
import type { AlertType } from "@prisma/client";

export interface AlertIdentity {
  type: AlertType;
  title: string;
  message: string;
  relatedId?: string | null;
  recipientUserId?: string | null;
}

function identityKey(a: AlertIdentity): string {
  return JSON.stringify([
    a.type,
    a.relatedId ?? null,
    a.recipientUserId ?? null,
    a.title,
    a.message,
  ]);
}

/** True when an undismissed alert with identical content already exists. */
export async function alertAlreadyOpen(a: AlertIdentity): Promise<boolean> {
  const existing = await db.alert.findFirst({
    where: {
      isDismissed: false,
      type: a.type,
      title: a.title,
      message: a.message,
      relatedId: a.relatedId ?? null,
      recipientUserId: a.recipientUserId ?? null,
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Batch form for createMany callers. Drops rows that duplicate an existing
 * undismissed alert AND rows that duplicate each other within the batch, in one
 * query rather than one per row.
 */
export async function withoutDuplicateAlerts<T extends AlertIdentity>(
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  // One query, narrowed by the fields that are indexed/cheap; the exact
  // content match happens in memory against the key set.
  const existing = await db.alert.findMany({
    where: {
      isDismissed: false,
      type: { in: [...new Set(rows.map((r) => r.type))] },
      OR: [
        ...new Set(rows.map((r) => r.relatedId ?? null)),
      ].map((relatedId) => ({ relatedId })),
    },
    select: {
      type: true,
      title: true,
      message: true,
      relatedId: true,
      recipientUserId: true,
    },
  });

  const seen = new Set(existing.map(identityKey));
  const out: T[] = [];
  for (const row of rows) {
    const key = identityKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

// ── Read side ───────────────────────────────────────────────────────────────
// The guards above only stop NEW duplicates. Rows written before they existed
// are still in the table and we do not delete alert rows, so the list also has
// to collapse on the way out — otherwise /admin/analytics?tab=alerts keeps
// rendering hundreds of "Overdue payment: <client>" cards.
//
// The key is the SAME `identityKey` the write guards use, `relatedId` included.
// One definition of "the same alert", read and write. An earlier version of
// this dropped `relatedId` on the theory that the duplicates were distinct jobs
// for one client that happened to render identically. Measured against the live
// table, that was wrong twice over:
//
//   undismissed OVERDUE_PAYMENT rows                      1492
//   distinct (type, relatedId, recipient)                  136   ← the real jobs
//   distinct (…, title, message) as well                   136   ← identical
//
// So the noise is 1356 rows that repeat the SAME job — the pre-fix runaway at
// analytics/page.tsx re-minting a row per page load — and including `relatedId`
// collapses every one of them. Dropping it, on the other hand, folded 11 rows
// spanning 5 distinct job ids into a single card and silently hid four real
// unpaid jobs. Hiding outstanding money is worse than showing a duplicate.
//
// Title+message stay in the key for the types where `relatedId` is NOT the
// whole identity. Measured on the same table:
//
//   LOW_INVENTORY   31 rows → 15 by triple, 29 by full identity
//   CLEANER_STRIKE   3 rows →  2 by triple,  3 by full identity
//
// Those extra rows are real: one Product id carries "Premsai requested 30 ml of
// Windex", "Tanya Mastrangelo requested 0.25 bottles of Windex" and "ADMIN
// requested 30 ml of Windex" as three separate restock requests. The bare
// triple would swallow 14 of them. On OVERDUE_PAYMENT the two keys are
// identical (136 = 136), so carrying title+message costs this fix nothing and
// keeps distinct requests on screen.
//
// `createdAt` is not in the key: two identical undismissed alerts a week apart
// are still one thing to act on, and including it would let every duplicate
// back through the moment its timestamp differed by a millisecond.
//
// A null `relatedId` is not treated as a shared value — title+message are in
// the key regardless, so unrelated relatedId-less alerts cannot collapse into
// each other. (No undismissed row currently has a null `relatedId`, but the
// column is nullable and GENERAL alerts may not carry one.)

export interface DisplayAlertIdentity extends AlertIdentity {
  createdAt: Date;
}

/**
 * Collapse rows that are the same alert, keeping the newest of each group.
 * Returns newest-first. Pure — it never touches the database.
 */
export function dedupeAlertsByIdentity<T extends DisplayAlertIdentity>(
  rows: T[],
): T[] {
  const newestFirst = [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of newestFirst) {
    const key = identityKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
