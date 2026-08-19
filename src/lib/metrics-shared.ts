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
import { INACTIVE_JOB_STATUSES, isOnHold } from "./job-hold";

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

// ── Has the job actually happened? (round 4, fix 1) ─────────────────────────
//
// The bug this answers: a job dated TOMORROW was rendering with a green
// "Completed" pill, sitting in the Completed tab, and incrementing the
// Completed stat — because every "is this done" test in the app was a pure
// read of the `status` enum, and several writers stamp that enum from PAYMENT
// state with no date guard (a BookingKoala import of a prepaid booking, the
// mark-paid toggle, a card charge, an invoice marked paid). Payment is not
// completion, and the enum alone cannot tell the two apart.
//
// So completion is now derived from the enum AND the calendar, in one place.
// The guard is DEFENSE IN DEPTH — the writers were fixed in the same round so
// they stop producing these rows, and a backfill repairs the ones already in
// the database — but a read-side rule is what makes a future job impossible to
// display as done no matter which writer misbehaves next.

/** Statuses that claim a job is finished. Coincides with `REVENUE_STATUSES`
 *  by value, deliberately kept separate: that one answers "did we earn this",
 *  this one answers "is the work over". They are free to diverge. */
export const COMPLETED_STATUSES = ["COMPLETED", "PAID"] as const;

/** The two columns every lifecycle predicate below reads. */
export interface JobLifecycleShape {
  status: string;
  startTime?: Date | string | null;
  /** Set when the crew clocked out — the strongest "this really happened"
   *  signal a job row carries, and the reason an early finish on a job that
   *  starts later today still reads as completed. */
  clockOutTime?: Date | string | null;
}

/**
 * Is this job still ahead of us — i.e. can it not possibly be finished?
 *
 * FAILS OPEN on purpose. A row handed over without `startTime` returns false
 * ("not provably future"), so a caller whose `select` omits the column keeps
 * exactly the old behaviour instead of silently reclassifying every job it
 * shows. The guard only ever fires when we actually know the date.
 */
export function isFutureJob(j: JobLifecycleShape, now: Date = new Date()): boolean {
  if (!j.startTime) return false;
  // Clocked out ⇒ worked, whatever the clock says. A 6 PM job finished early
  // at 4 PM is done, not "future".
  if (j.clockOutTime) return false;
  return new Date(j.startTime).getTime() > now.getTime();
}

/**
 * Is this job genuinely completed — stamped done AND actually past?
 *
 * The predicate behind the Jobs page's Completed tab, its tab count, its
 * Completed stat card, and (in SQL form, `jobStatusWhere("completed")`) the
 * Dashboard's completed count. One function so those four can never disagree
 * about which jobs are completed, which was the other half of this fix.
 */
export function isCompletedJob(j: JobLifecycleShape, now: Date = new Date()): boolean {
  if (!(COMPLETED_STATUSES as readonly string[]).includes(j.status)) return false;
  return !isFutureJob(j, now);
}

/**
 * Is this job still coming up for the business?
 *
 * The complement of `isCompletedJob` over future-dated work, rather than an
 * allow-list of statuses. That matters: the allow-list it replaces was
 * {CREATED, SCHEDULED, IN_PROGRESS}, so a future job mis-stamped COMPLETED or
 * PAID matched NO tab at all — dropped from Completed by the guard above and
 * never picked up by Upcoming. A future job is upcoming unless it is cancelled
 * or was genuinely worked.
 *
 * Round 4, fix 6: ...or ON HOLD. The PDF is explicit that "on-hold jobs should
 * not count as active or scheduled", and a $0 import nobody has priced is not
 * work anyone is coming to do. It is not lost — `isOnHoldJob` below is its own
 * bucket with its own tab and a Release button, which is the other half of the
 * fix. Read the two together: nothing falls between them.
 */
export function isUpcomingJob(j: JobLifecycleShape, now: Date = new Date()): boolean {
  if (j.status === "CANCELLED") return false;
  if (isOnHold(j)) return false;
  if (isCompletedJob(j, now)) return false;
  if (!j.startTime) return false;
  return new Date(j.startTime).getTime() >= now.getTime();
}

/**
 * Is this job on hold — parked, with a reason, waiting for an admin?
 *
 * Round 4, fix 6. The SQL twin is `jobStatusWhere("onhold")`. Deliberately has
 * NO date test: a hold does not expire because its date slid past, which is
 * exactly what the nightly sweep used to do to one (it swept CREATED →
 * COMPLETED, so an unpriced import silently reported as finished work — see
 * src/lib/job-sweep.ts).
 */
export function isOnHoldJob(j: JobLifecycleShape): boolean {
  return isOnHold(j);
}

/** The columns `isActiveJob` reads. */
export interface ActiveJobShape {
  status: string;
  deletedAt?: Date | string | null;
}

/**
 * Does this job count as a job the business is actually doing?
 *
 * Round 4, fix 3 + fix 6, and the PURE twin of `activeJobsWhere()` in
 * metrics.ts — Analytics filters its list in memory, the Dashboard counts in
 * SQL, and the two must agree. Cancelled work was never done and on-hold work
 * has not been agreed to; neither belongs in "Total jobs". Both stay visible as
 * their own counts beside it, which is what the PDF asks for ("cancelled jobs
 * should still be visible in records or as a separate stat").
 */
export function isActiveJob(j: ActiveJobShape): boolean {
  if (j.deletedAt) return false;
  return !(INACTIVE_JOB_STATUSES as readonly string[]).includes(j.status);
}

// ── Simplified operational status ───────────────────────────────────────────
// The three main operational statuses per spec: Scheduled (job date still
// ahead), Completed (date passed, payment not received), Paid (payment
// received). Derived, not stored — so a job whose date passed overnight reads
// "Completed" immediately even before the daily sweep updates the DB row, and
// "Paid" can never diverge between the status enum and the paymentReceived
// boolean. IN_PROGRESS (cleaner on site) and CANCELLED pass through untouched.
export type SimpleJobStatus =
  | "ON_HOLD"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PAID"
  | "CANCELLED";

export function simpleJobStatus(
  j: JobLifecycleShape & {
    paymentReceived?: boolean | null;
  },
  now: Date = new Date()
): SimpleJobStatus {
  if (j.status === "CANCELLED") return "CANCELLED";
  // Round 4, fix 6 — ON HOLD, before every derivation below it.
  //
  // A held job used to print whatever the date happened to imply: "Scheduled"
  // while its date was ahead, and "Completed" the morning after (the
  // `startTime < startOfDay` branch at the bottom of this function, plus the
  // nightly sweep writing the same thing into the row). So the one status an
  // admin had to act on was the one status the app never showed. It is first
  // because a hold is a statement about the AGREEMENT, and no amount of clock
  // settles an agreement: an unpriced import does not become finished work by
  // being left alone overnight.
  //
  // Payment is not hidden by this — a held job that was somehow paid shows its
  // payment in the payment column, which is where fix 1 established payment
  // belongs.
  if (isOnHold(j)) return "ON_HOLD";
  // Round 4, fix 1. The `paymentReceived || PAID ⇒ PAID` branch below used to
  // fire before any date logic, so this function — which draws the pill on
  // every jobs row, the dashboard list and the job detail header, and backs the
  // status filter — printed "Paid" (a done status) over a job that has not
  // happened. A future job is Scheduled; its payment shows in the payment
  // column, which is where payment belongs.
  const future = isFutureJob(j, now);
  if (!future && (j.paymentReceived || j.status === "PAID")) return "PAID";
  // IN_PROGRESS stays untouched by the date guard: a cleaner may clock in up to
  // CLOCK_IN_EARLY_WINDOW_MIN (2h) before the scheduled start, so "on site" is
  // legitimately reachable while `startTime` is still in the future.
  if (j.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (!future && j.status === "COMPLETED") return "COMPLETED";
  // SCHEDULED: the job date has passed (previous business day or earlier) →
  // Completed. Same-day jobs stay Scheduled until clock-out. CREATED used to
  // reach here too and no longer can — it returns ON_HOLD above.
  if (j.startTime && new Date(j.startTime) < startOfDayTz(now)) {
    return "COMPLETED";
  }
  return "SCHEDULED";
}
