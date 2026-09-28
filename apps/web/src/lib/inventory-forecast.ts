// Per-product usage derived from what cleaners ACTUALLY reported
// (awerfixes.pdf item 14 — remove the Inventory Rules settings).
//
// PURE module — no Prisma client, no `db`. Callers pass rows in; this decides
// what they mean. Same constraint `service-permissions.ts` and
// `inventory-thresholds.ts` document, and for the same reason: it is imported
// by server components, by server actions AND by the verify script, which has
// no database.
//
// WHY THIS EXISTS
// ---------------
// `InventoryRule.usagePerJob` was a number an admin typed into Settings once and
// then never revisited. Six surfaces read it — the inventory forecast, a second
// forecast on the employee page, the calendar's "missing equipment" badge, the
// required-equipment checks on both the admin and cleaner job views, and the
// low-stock floor — so a stale guess propagated everywhere at once, and any
// product nobody had written a rule for was treated as consuming zero.
//
// `clockOut` already records what was really used, per job, per product
// (`JobProductUsage`). That is a measurement rather than an estimate, it
// updates itself, and it covers every product that has ever been used. So all
// six surfaces now read this instead, from ONE implementation — the same
// "one shared function, none of them restate the rule" discipline the service
// permission and availability work landed on.
//
// WHAT "PER JOB" MEANS HERE
// -------------------------
// The average is over the jobs that actually used the product, NOT over every
// job in the window. A product used heavily on the two post-construction jobs
// in a month should project from those two, not be divided by the sixty
// residential cleans that never touched it — otherwise the forecast quietly
// under-orders the thing most likely to run out.

/** One `JobProductUsage` row, reduced to what the maths needs. */
export interface UsageRow {
  productId: string;
  jobId: string;
  quantity: number;
  /**
   * The job's date — NOT the row's `createdAt`. Those diverge: the row is
   * created on the first clock-out and `quantity` then accumulates across later
   * ones (`@@unique([jobId, productId])` makes the write an update), so
   * `createdAt` dates the first visit while the number covers all of them.
   * `Job.jobDate` is the honest key for a time window.
   *
   * Nullable because `Job.jobDate` is. A row with no date cannot be placed in
   * or out of the window, so it is skipped rather than guessed at — counting it
   * would silently drag the average one way or the other.
   */
  jobDate: Date | null;
}

/** The default look-back. Long enough to smooth a quiet week, short enough to follow a real change in how the crews work. */
export const USAGE_WINDOW_DAYS = 30;

export interface PerJobAverageOptions {
  /** Window end. Injected so callers — and the verify script — are deterministic. */
  now?: Date;
  windowDays?: number;
}

/**
 * Average quantity consumed per job that used it, per product, over the window.
 *
 * A product with no usage in the window is ABSENT from the map rather than
 * present with 0. The distinction matters: "we have no evidence" and "we
 * measured zero" call for different UI, and collapsing them is how the old
 * rule-based forecast made products vanish.
 */
export function perJobAverages(
  rows: UsageRow[],
  options: PerJobAverageOptions = {}
): Map<string, number> {
  const windowDays = options.windowDays ?? USAGE_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - windowDays * 86400000);

  // Per product: total quantity, and the DISTINCT jobs it was used on. Distinct
  // because a job can contribute more than one row across repeated clock-outs;
  // counting rows would divide by visits and understate the per-job figure.
  const totals = new Map<string, { quantity: number; jobs: Set<string> }>();
  for (const row of rows) {
    if (!row.productId || !Number.isFinite(row.quantity)) continue;
    if (row.quantity <= 0) continue;
    if (row.jobDate == null) continue;
    const at = row.jobDate instanceof Date ? row.jobDate : new Date(row.jobDate);
    if (Number.isNaN(at.getTime())) continue;
    if (at < cutoff || at > now) continue;

    let entry = totals.get(row.productId);
    if (!entry) {
      entry = { quantity: 0, jobs: new Set() };
      totals.set(row.productId, entry);
    }
    entry.quantity += row.quantity;
    entry.jobs.add(row.jobId);
  }

  const out = new Map<string, number>();
  for (const [productId, { quantity, jobs }] of totals) {
    if (jobs.size === 0) continue;
    out.set(productId, quantity / jobs.size);
  }
  return out;
}

/**
 * Project consumption over a number of upcoming jobs, rounded to two decimals
 * so the UI never prints 3.0000000000000004.
 */
export function projectUsage(
  averagePerJob: number | undefined,
  upcomingJobCount: number
): number {
  if (!averagePerJob || averagePerJob <= 0) return 0;
  if (!upcomingJobCount || upcomingJobCount <= 0) return 0;
  return Math.round(averagePerJob * upcomingJobCount * 100) / 100;
}

/**
 * Whether there is enough history to say anything at all. Surfaces that used to
 * warn off `usagePerJob > 0` ask this instead, so a fresh install shows "no
 * usage recorded yet" rather than claiming every cleaner is fully stocked.
 */
export function hasUsageHistory(averages: Map<string, number>): boolean {
  return averages.size > 0;
}
