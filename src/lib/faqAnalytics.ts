"use server";

import { db } from "@/db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import type { FaqEventType } from "@prisma/client";

/**
 * FAQ analytics (CLN-P1-4-17) — the write path used by both FAQ surfaces and
 * the admin read behind the settings panel.
 *
 * `recordFaqEvent` is reachable from the PUBLIC /faq page and is therefore
 * unauthenticated. It is bounded on every axis a forged call could stretch —
 * a four-value enum, a query capped at 80 characters, an id checked against the
 * table before it is stored — and it never throws, so a broken analytics write
 * can't take down the page it is measuring. It is NOT rate limited; that gap is
 * shared with /api/stripe/charge-deposit and lead/quote submission and is
 * flagged in the migration rather than half-fixed here.
 */

const MAX_QUERY = 80;
const MIN_QUERY = 2;
const VALID_TYPES: FaqEventType[] = ["VIEW", "OPEN", "SEARCH", "SEARCH_NO_RESULT"];

export interface FaqEventInput {
  type: FaqEventType;
  faqId?: string | null;
  query?: string | null;
  surface: "public" | "portal";
}

/** Fire-and-forget. Returns nothing; failures are swallowed by design. */
export async function recordFaqEvent(input: FaqEventInput): Promise<void> {
  try {
    const type = input?.type;
    if (!VALID_TYPES.includes(type)) return;

    const surface = input?.surface === "portal" ? "portal" : "public";

    // Normalised so "Parking", "parking " and "PARKING" are one popular search
    // rather than three.
    let query: string | null = null;
    if (type === "SEARCH" || type === "SEARCH_NO_RESULT") {
      const raw = typeof input.query === "string" ? input.query.trim().toLowerCase() : "";
      if (raw.length < MIN_QUERY) return; // a single letter is a keystroke, not a search
      query = raw.slice(0, MAX_QUERY);
    }

    // Only OPEN is about a specific question. Checked against the table so a
    // stale tab (or the legacy fallback's synthetic ids) records an untethered
    // event instead of failing the FK and losing the row entirely.
    let faqId: string | null = null;
    if (type === "OPEN" && typeof input.faqId === "string" && input.faqId) {
      const found = await db.faq.findUnique({
        where: { id: input.faqId },
        select: { id: true },
      });
      faqId = found?.id ?? null;
    }

    await db.faqEvent.create({ data: { type, faqId, query, surface } });
  } catch (e) {
    // Analytics must never break the FAQ.
    console.error("[faq] event write failed", e);
  }
}

/* ─────────────────────────── admin read ────────────────────────────────── */

export interface FaqAnalyticsRow {
  label: string;
  count: number;
}

export interface FaqAnalyticsDTO {
  /** Days the figures cover. */
  windowDays: number;
  pageViews: number;
  /** "Most-viewed" and "opened most often" are the same metric — see the note. */
  topQuestions: FaqAnalyticsRow[];
  topSearches: FaqAnalyticsRow[];
  emptySearches: FaqAnalyticsRow[];
}

const WINDOW_DAYS = 90;
const TOP_N = 10;

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function getFaqAnalytics(): Promise<Result<FaqAnalyticsDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [pageViews, opens, searches, empties] = await Promise.all([
      db.faqEvent.count({ where: { type: "VIEW", createdAt: { gte: since } } }),
      db.faqEvent.groupBy({
        by: ["faqId"],
        where: { type: "OPEN", createdAt: { gte: since }, faqId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { faqId: "desc" } },
        take: TOP_N,
      }),
      db.faqEvent.groupBy({
        by: ["query"],
        where: { type: "SEARCH", createdAt: { gte: since }, query: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { query: "desc" } },
        take: TOP_N,
      }),
      db.faqEvent.groupBy({
        by: ["query"],
        where: { type: "SEARCH_NO_RESULT", createdAt: { gte: since }, query: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { query: "desc" } },
        take: TOP_N,
      }),
    ]);

    // Resolve question text in one query rather than one per row.
    const ids = opens.map((o) => o.faqId).filter((i): i is string => !!i);
    const questions = ids.length
      ? await db.faq.findMany({ where: { id: { in: ids } }, select: { id: true, question: true } })
      : [];
    const byId = new Map(questions.map((q) => [q.id, q.question]));

    return {
      success: true,
      data: {
        windowDays: WINDOW_DAYS,
        pageViews,
        topQuestions: opens.map((o) => ({
          // A question deleted since it was opened still counts; it just has no
          // text left to show.
          label: byId.get(o.faqId ?? "") ?? "(deleted question)",
          count: o._count._all,
        })),
        topSearches: searches.map((s) => ({ label: s.query ?? "", count: s._count._all })),
        emptySearches: empties.map((s) => ({ label: s.query ?? "", count: s._count._all })),
      },
    };
  } catch (e) {
    console.error("[faq] analytics read failed", e);
    return { success: false, error: "Could not load FAQ analytics. Has the migration been applied?" };
  }
}
