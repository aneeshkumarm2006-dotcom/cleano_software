// Per-person request activity, the evidence for the offline clock rule
// (API_V1.md §6; the decision itself is decideEventTime in
// @bookmops/core/time).
//
// Every authenticated /api/v1 request sets one bit: the second it arrived in,
// in its person's row for that minute. A clock event that claims "no signal
// from occurredAt until now" is disproven by any bit between the tap and the
// reconnection, on any of the person's sessions. A single "last request"
// timestamp, which this replaced, could be overwritten by a request made in
// the reconnect grace just before the event.
//
// Tenant-scoped like any other table: organizationId on every row, RLS forced,
// and the raw SQL here filters on the company explicitly as well.
import "server-only";

import { ACTIVITY_RETENTION_MS } from "@bookmops/core/time";

import { db } from "@/lib/org-db";

const MINUTE_MS = 60_000;
const RETENTION_MINUTES = Math.ceil(ACTIVITY_RETENTION_MS / MINUTE_MS);

/**
 * The last second recorded per person on this instance, so a busy screen
 * writes at most once a second, and the minute last pruned. Bounded; losing
 * it only costs a redundant write.
 */
const recent = new Map<string, { second: number; prunedMinute: number }>();
const RECENT_MAX = 20_000;

/** Record that `userId` made an authenticated request at `at`. Never throws. */
export async function recordActivity(organizationId: string, userId: string, at: Date): Promise<void> {
  try {
    const second = Math.floor(at.getTime() / 1_000);
    const minute = Math.floor(second / 60);
    const key = `${organizationId}:${userId}`;
    const seen = recent.get(key);
    if (seen && seen.second === second) return;

    const bit = BigInt(1) << BigInt(second - minute * 60);
    await db.$executeRaw`
      INSERT INTO "UserRequestActivity" ("organizationId", "userId", "minute", "seconds")
      VALUES (${organizationId}, ${userId}, ${minute}, ${bit})
      ON CONFLICT ("organizationId", "userId", "minute")
      DO UPDATE SET "seconds" = "UserRequestActivity"."seconds" | EXCLUDED."seconds"`;

    // A new minute for this person: drop what has aged out. The daily
    // retention cron sweeps anyone this never gets to.
    const pruned = seen?.prunedMinute ?? -1;
    if (pruned !== minute) {
      await db.$executeRaw`
        DELETE FROM "UserRequestActivity"
        WHERE "organizationId" = ${organizationId}
          AND "userId" = ${userId}
          AND "minute" < ${minute - RETENTION_MINUTES}`;
    }

    if (recent.size >= RECENT_MAX) recent.clear();
    recent.set(key, { second, prunedMinute: minute });
  } catch (e) {
    console.error(JSON.stringify({ at: "v1.activity.record", error: String(e).slice(0, 200) }));
  }
}

/**
 * The seconds (as their start instants) in which `userId` made requests over
 * the retained span before `now`, for decideEventTime's `activeSeconds`.
 */
export async function recentActivity(organizationId: string, userId: string, now: Date): Promise<Date[]> {
  const fromMinute = Math.floor((now.getTime() - ACTIVITY_RETENTION_MS) / MINUTE_MS);
  const rows = await db.$queryRaw<{ minute: number; seconds: bigint }[]>`
    SELECT "minute", "seconds"
    FROM "UserRequestActivity"
    WHERE "organizationId" = ${organizationId}
      AND "userId" = ${userId}
      AND "minute" >= ${fromMinute}`;
  return expandActivity(rows);
}

/** Bits to instants. Exported for the rules script. */
export function expandActivity(rows: readonly { minute: number; seconds: bigint | number | string }[]): Date[] {
  const out: Date[] = [];
  for (const r of rows) {
    const bits = BigInt(r.seconds);
    for (let i = 0; i < 60; i++) {
      if ((bits >> BigInt(i)) & BigInt(1)) out.push(new Date((Number(r.minute) * 60 + i) * 1_000));
    }
  }
  return out;
}
