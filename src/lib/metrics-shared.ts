// Client-safe half of src/lib/metrics.ts.
//
// metrics.ts is `import "server-only"` because it talks to the DB. The PURE
// predicates below carry the same canonical definitions but have zero server
// imports, so a client component (e.g. the Jobs list stat cards, which must
// recompute revenue over the CLIENT-side filtered list) can apply the exact
// same rule the server uses. metrics.ts re-exports everything here, so server
// code keeps importing from "@/lib/metrics" and the two can never drift.

import { startOfDayTz } from "./time";
import { activeSubtotal, type ActiveValueJob } from "./job-money";

// ── Total Revenue ───────────────────────────────────────────────────────────
// Spec: completed AND paid jobs only; excludes taxes; applies discounts;
// subtracts refunds; includes paid cash jobs; excludes cancelled + unpaid.
export const REVENUE_STATUSES = ["COMPLETED", "PAID"] as const;

/**
 * Fields any revenue predicate needs. Both Prisma rows and job DTOs satisfy it.
 *
 * It EXTENDS `ActiveValueJob` (fix 3), so the money columns — `subtotalAmount`,
 * `bookingSource`, `pricingMode` and the `addOns` rows — are required, not
 * optional. A `select` that omits one is a compile error rather than a
 * dashboard quietly reverting to the bare `Job.price` this stage removed.
 */
export interface RevenueJobShape extends ActiveValueJob {
  deletedAt?: Date | string | null;
  status: string;
  paymentReceived: boolean;
  refundedAmount?: number | null;
}

/**
 * Does this job count toward realized revenue? Mirrors `revenueWhere()` in
 * metrics.ts exactly: not archived, payment received, completed/paid.
 */
export function isRevenueJob(j: RevenueJobShape): boolean {
  if (j.deletedAt) return false;
  if (!j.paymentReceived) return false;
  return (REVENUE_STATUSES as readonly string[]).includes(j.status);
}

/**
 * Per-job realized revenue: the ACTIVE pre-tax subtotal, less refunds.
 *
 * Fix 3. This used to be `price − discount − refunds`, which read the BASE
 * service line and so hid every add-on and extra charge from every revenue
 * figure in the app: the grout job on page 2 of the PDF counted $128 toward
 * revenue while the customer was billed for $186 of work.
 *
 * **The discount is NOT subtracted here any more, and that is not a change in
 * meaning — it is where the subtraction moved to.** `activeSubtotal` is already
 * discount-net in both modes: ITEMIZED computes `base + Σ add-ons − discount`,
 * and under FINAL_PRICE the stored subtotal has the discount inside it
 * (subtracting again is the double-application lib/job-billing.ts records as
 * having taken ~$54 off a $25 referral credit). A literal
 * `activeSubtotal − discount − refunds` would reintroduce exactly that bug.
 *
 * Deliberate asymmetry with the CLEANER PAY basis (decision D5, Stage 4):
 * revenue is discount-net, the pay basis is not. A discount is company
 * marketing spend, not a smaller job, so it must not quietly cut what a cleaner
 * earns. The two therefore build on `activeSubtotal` separately rather than
 * sharing one number — if you are here to make them agree, read D5 first.
 */
export function jobRevenue(j: ActiveValueJob & { refundedAmount?: number | null }): number {
  return Math.max(0, activeSubtotal(j) - (j.refundedAmount ?? 0));
}

/** Sum of realized revenue over a list, applying the canonical predicate. */
export function totalRevenueOf(jobs: RevenueJobShape[]): number {
  return jobs.reduce((sum, j) => (isRevenueJob(j) ? sum + jobRevenue(j) : sum), 0);
}

// ── Scheduled (booked, not yet realized) value ───────────────────────────────
// Deliberately NOT revenue: work that is on the books but not completed+paid.
// Surfaced as its own stat so a pipeline of priced-but-unpaid jobs doesn't make
// the page look like it's showing $0.00 "revenue".

/** Booked but not yet realized: live job, not cancelled, not already revenue. */
export function isScheduledValueJob(j: RevenueJobShape): boolean {
  if (j.deletedAt) return false;
  if (j.status === "CANCELLED") return false;
  return !isRevenueJob(j);
}

/**
 * Per-job booked value: the ACTIVE pre-tax subtotal (no refunds — nothing has
 * been paid yet).
 *
 * Moved onto the same basis as `jobRevenue` in fix 3, and it had to be: these
 * two cards sit side by side on the Jobs page and the Dashboard, and a job
 * crosses from one to the other the moment it is marked paid. Leaving booked
 * value on the bare price would have made an add-on job appear to GAIN $58 on
 * payday, which reads as a bug in the very report meant to prove the fix.
 * Discount handling is `activeSubtotal`'s, exactly as above.
 */
export function jobScheduledValue(j: ActiveValueJob): number {
  return Math.max(0, activeSubtotal(j));
}

/** Sum of booked-but-unrealized value over a list. */
export function totalScheduledValueOf(jobs: RevenueJobShape[]): number {
  return jobs.reduce(
    (sum, j) => (isScheduledValueJob(j) ? sum + jobScheduledValue(j) : sum),
    0
  );
}

// ── Employee count ──────────────────────────────────────────────────────────
// Field staff — the people who actually clean or manage crews. Excludes CLIENT
// (imported customers) and the office OWNER/ADMIN (counted separately).
export const EMPLOYEE_ROLES = ["OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"] as const;

// ── Simplified operational status ───────────────────────────────────────────
// The three main operational statuses per spec: Scheduled (job date still
// ahead), Completed (date passed, payment not received), Paid (payment
// received). Derived, not stored — so a job whose date passed overnight reads
// "Completed" immediately even before the daily sweep updates the DB row, and
// "Paid" can never diverge between the status enum and the paymentReceived
// boolean. IN_PROGRESS (cleaner on site) and CANCELLED pass through untouched.
export type SimpleJobStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PAID"
  | "CANCELLED";

export function simpleJobStatus(
  j: {
    status: string;
    paymentReceived?: boolean | null;
    startTime?: Date | string | null;
  },
  now: Date = new Date()
): SimpleJobStatus {
  if (j.status === "CANCELLED") return "CANCELLED";
  if (j.paymentReceived || j.status === "PAID") return "PAID";
  if (j.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (j.status === "COMPLETED") return "COMPLETED";
  // CREATED / SCHEDULED: the job date has passed (previous business day or
  // earlier) → Completed. Same-day jobs stay Scheduled until clock-out.
  if (j.startTime && new Date(j.startTime) < startOfDayTz(now)) {
    return "COMPLETED";
  }
  return "SCHEDULED";
}
