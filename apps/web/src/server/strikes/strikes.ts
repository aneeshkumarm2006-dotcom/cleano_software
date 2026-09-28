// Strikes: the caller's own reliability record (packages/api/src/v1/strikes.ts).
//
// Read-only and self-scoped: strikes WHERE cleanerId = actor.userId, and no id
// comes from the request. Never sent: the admin's private note, who applied or
// excused a strike, or anything about the job's client (only its id and
// number). The rules are the web's (lib/strikes-constants.ts): a strike is
// active for STRIKE_WINDOW_DAYS, and STRIKE_THRESHOLD active strikes mean an
// admin review.
import "server-only";

import { db } from "@/lib/org-db";
import { STRIKE_REASON_LABELS, STRIKE_THRESHOLD, STRIKE_WINDOW_DAYS, strikeLevel } from "@/lib/strikes-constants";

import type { Actor } from "../actor";
import { ok, type Result } from "../result";

/** As many as the web's strikes page shows. */
const MAX_ITEMS = 100;

export interface StrikeItemView {
  id: string;
  title: string;
  reason: string;
  status: string;
  givenAt: string;
  expiresAt: string;
  job: { id: string; number: number } | null;
}

export interface StrikesView {
  activeCount: number;
  threshold: number;
  windowDays: number;
  level: string;
  items: StrikeItemView[];
}

export async function myStrikesFor(actor: Actor, now: Date): Promise<Result<StrikesView>> {
  const [activeCount, rows] = await Promise.all([
    db.cleanerStrike.count({ where: { cleanerId: actor.userId, status: "ACTIVE", expiresAt: { gt: now } } }),
    db.cleanerStrike.findMany({
      where: { cleanerId: actor.userId },
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS,
      // An allow-list: adminNote, appliedById, excusedById and the client are
      // never read, so they can't be sent by mistake.
      select: {
        id: true,
        reasonCode: true,
        reason: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        job: { select: { id: true, jobNumber: true } },
      },
    }),
  ]);

  return ok({
    activeCount,
    threshold: STRIKE_THRESHOLD,
    windowDays: STRIKE_WINDOW_DAYS,
    level: strikeLevel(activeCount),
    items: rows.map((s) => ({
      id: s.id,
      title: STRIKE_REASON_LABELS[s.reasonCode] ?? "Strike",
      reason: s.reason,
      // A strike still marked active whose date has passed has rolled off; it
      // is only waiting on the sweep.
      status: s.status === "ACTIVE" && s.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : s.status,
      givenAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      job: s.job ? { id: s.job.id, number: s.job.jobNumber } : null,
    })),
  });
}
