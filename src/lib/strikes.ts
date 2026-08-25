import { db } from "@/lib/org-db";
import type { StrikeReason } from "@prisma/client";
import {
  STRIKE_WINDOW_DAYS,
  STRIKE_THRESHOLD,
  STRIKE_REASON_LABELS,
  strikeLevel,
  type StrikeLevel,
} from "@/lib/strikes-constants";

export {
  STRIKE_WINDOW_DAYS,
  STRIKE_THRESHOLD,
  STRIKE_REASON_LABELS,
  strikeLevel,
} from "@/lib/strikes-constants";
export type { StrikeLevel } from "@/lib/strikes-constants";

export interface StrikeSummary {
  activeCount: number;
  level: StrikeLevel;
}

/** Where-clause matching strikes that currently count (rolling window). */
function activeWhere(cleanerId: string) {
  return {
    cleanerId,
    status: "ACTIVE" as const,
    expiresAt: { gt: new Date() },
  };
}

/** Active strike count for a cleaner under the rolling 30-day window. */
export async function getActiveStrikeCount(cleanerId: string): Promise<number> {
  return db.cleanerStrike.count({ where: activeWhere(cleanerId) });
}

export async function getStrikeSummary(cleanerId: string): Promise<StrikeSummary> {
  const activeCount = await getActiveStrikeCount(cleanerId);
  return { activeCount, level: strikeLevel(activeCount) };
}

interface ApplyStrikeInput {
  cleanerId: string;
  reasonCode: StrikeReason;
  /** Optional human detail appended to the reason label. */
  detail?: string;
  jobId?: string | null;
  /** false for admin-added manual strikes. */
  isAuto?: boolean;
  /** Admin user id when manually applied. */
  appliedById?: string | null;
  adminNote?: string | null;
  /** When true, skip if an active strike already exists for the same
   *  (cleaner, reason, job). Prevents an event from striking twice. */
  dedupePerJob?: boolean;
}

/**
 * Apply a strike to a cleaner. Auto-triggers call this from the relevant
 * job flows; admins call it via the manual add action. Returns the created
 * strike, or null when deduped. Raises a CLEANER_STRIKE admin alert when the
 * cleaner crosses the {@link STRIKE_THRESHOLD}.
 */
export async function applyStrike(
  input: ApplyStrikeInput
): Promise<{ created: boolean; activeCount: number }> {
  const {
    cleanerId,
    reasonCode,
    detail,
    jobId = null,
    isAuto = true,
    appliedById = null,
    adminNote = null,
    dedupePerJob = false,
  } = input;

  if (dedupePerJob && jobId) {
    const existing = await db.cleanerStrike.findFirst({
      where: {
        cleanerId,
        reasonCode,
        jobId,
        status: { in: ["ACTIVE", "EXPIRED"] },
      },
      select: { id: true },
    });
    if (existing) {
      return { created: false, activeCount: await getActiveStrikeCount(cleanerId) };
    }
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + STRIKE_WINDOW_DAYS);

  const reason = detail
    ? `${STRIKE_REASON_LABELS[reasonCode]} — ${detail}`
    : STRIKE_REASON_LABELS[reasonCode];

  await db.cleanerStrike.create({
    data: {
      cleanerId,
      reasonCode,
      reason,
      jobId,
      isAuto,
      appliedById,
      adminNote,
      expiresAt,
    },
  });

  const activeCount = await getActiveStrikeCount(cleanerId);

  // Flag for admin review the moment the cleaner reaches the threshold.
  if (activeCount >= STRIKE_THRESHOLD) {
    const cleaner = await db.user.findUnique({
      where: { id: cleanerId },
      select: { name: true },
    });
    await db.alert
      .create({
        data: {
          type: "CLEANER_STRIKE",
          severity: "CRITICAL",
          title: `${cleaner?.name ?? "Cleaner"} reached ${activeCount} active strikes`,
          message: `${cleaner?.name ?? "This cleaner"} now has ${activeCount} active strikes and needs admin review. Latest: ${reason}`,
          relatedId: cleanerId,
          relatedType: "User",
        },
      })
      .catch((e) => console.error("cleaner-strike alert", e));
  }

  return { created: true, activeCount };
}

/** Source tags used by the customer-facing rating flows. Penalty/admin
 *  ratings are excluded from the "consecutive low ratings" rule. */
const CUSTOMER_RATING_SOURCES = ["client-link", "client-portal"];

/**
 * Apply a strike when a cleaner's two most recent *customer* ratings are both
 * below 3 stars. Call right after a customer rating is recorded. Deduped on
 * the triggering job so the same pair can't strike twice.
 */
export async function maybeApplyLowRatingStrike(
  cleanerId: string,
  jobId?: string | null
): Promise<void> {
  const recent = await db.employeeRating.findMany({
    where: { employeeId: cleanerId, ratedBy: { in: CUSTOMER_RATING_SOURCES } },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { rating: true },
  });
  if (recent.length === 2 && recent.every((r) => r.rating < 3)) {
    await applyStrike({
      cleanerId,
      reasonCode: "LOW_RATINGS_CONSECUTIVE",
      jobId: jobId ?? null,
      dedupePerJob: true,
    });
  }
}
