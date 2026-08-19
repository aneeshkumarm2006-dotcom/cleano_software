// Customer-side HOURLY BILLING (PDF #8, Stage 8).
//
// ## The one distinction this whole module exists to protect
//
// There are now two hourly numbers on a Job and they are NOT the same money:
//
//   Job.hourlyRate        what the CLEANER is paid per hour  (payType HOURLY)
//   Job.billedHourlyRate  what the CUSTOMER is charged per hour (billingType HOURLY)
//
// Before this stage only the first existed, and "hourly job" in the admin UI
// meant "hourly cleaner pay" — there was no customer-side hourly price at all,
// which is what PDF #8 reports. The columns are deliberately named apart, the
// modal keeps them in two separate sections (decision D6), and nothing in this
// file ever reads `hourlyRate`.
//
// PURE — no DB, no framework, no `@prisma/client` import. Three client
// components render through `computeJobMoney`, which imports this file, so a
// server-only import here would break the build at the far end of the app.
// The ONE import is `./work-sessions`, which is pure by the same rule and for
// the same reason: round 4 makes the customer's billable hours and the cleaner's
// paid hours the same measurement, and it lives there (see the crew-hours note
// further down). The verify script pins the allow-list of one.
// The enum values below mirror `enum JobBillingType` in schema.prisma; the
// verify script asserts the two lists match.

import {
  crewActiveMinutes,
  type CrewBreak,
  type CrewSession,
} from "./work-sessions";

/** `Job.billingType`. Spelled as a union, not imported — see the header. */
export type JobBillingType = "FLAT" | "HOURLY";

export const JOB_BILLING_TYPES: readonly JobBillingType[] = [
  "FLAT",
  "HOURLY",
] as const;

export function isBillingType(v: unknown): v is JobBillingType {
  return v === "FLAT" || v === "HOURLY";
}

/**
 * Labels and hints. Worded for decision D6: the admin must never be able to
 * confuse the customer rate with the cleaner's rate, so both strings say
 * "customer" out loud and neither says "pay".
 */
export const BILLING_TYPE_LABEL: Record<JobBillingType, string> = {
  FLAT: "Flat price",
  HOURLY: "Hourly",
};

export const BILLING_TYPE_HINT: Record<JobBillingType, string> = {
  FLAT: "One agreed price for the job, however long it takes.",
  HOURLY: "The customer is billed an hourly rate × the job's billable hours.",
};

/**
 * Rounding for the actual-hours snapshot (decision D7): nearest quarter hour,
 * admin-editable afterwards. A 2h47m job bills 2.75h.
 */
export const BILLED_HOURS_INCREMENT = 0.25;

/** Longest single job this will ever bill, as a sanity clamp on form input. */
export const MAX_BILLED_HOURS = 999;

export function roundBilledHours(hours: number): number {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return (
    Math.round(Math.min(n, MAX_BILLED_HOURS) / BILLED_HOURS_INCREMENT) *
    BILLED_HOURS_INCREMENT
  );
}

/** The four columns any hourly calculation reads. All optional — see `isHourlyBilled`. */
export interface HourlyBillingFields {
  billingType?: JobBillingType | string | null;
  billedHourlyRate?: number | null;
  billedEstimatedHours?: number | null;
  /** Snapshotted at final clock-out from the work sessions; admin-editable. */
  billedActualHours?: number | null;
}

/**
 * Is this job billed by the hour?
 *
 * An absent/garbage `billingType` reads as FLAT, which is every row written
 * before this stage and every caller that hasn't been threaded — so a `select`
 * that forgets the column degrades to today's behaviour rather than to a
 * different price. (Both save paths ALSO keep `Job.price` equal to the derived
 * hourly amount, so such a caller still prints the right number; see
 * `hourlyServiceAmount` below.)
 */
export function isHourlyBilled(job: HourlyBillingFields | null | undefined): boolean {
  return job?.billingType === "HOURLY";
}

/**
 * The hours this job actually bills: what was worked, else what was estimated.
 *
 * `billedActualHours` wins the moment it exists — that is the whole point of
 * snapshotting it at clock-out — and `?? billedEstimatedHours` is what an
 * unstarted job quotes. Returns null when neither is a usable positive number,
 * which is the "hourly job with nothing entered yet" case.
 */
export function billedHours(
  job: HourlyBillingFields | null | undefined
): number | null {
  const actual = Number(job?.billedActualHours);
  if (Number.isFinite(actual) && actual > 0) return actual;
  const estimated = Number(job?.billedEstimatedHours);
  if (Number.isFinite(estimated) && estimated > 0) return estimated;
  return null;
}

/** Which of the two figures `billedHours` returned — for labelling, never for arithmetic. */
export function billedHoursSource(
  job: HourlyBillingFields | null | undefined
): "ACTUAL" | "ESTIMATED" | "NONE" {
  const actual = Number(job?.billedActualHours);
  if (Number.isFinite(actual) && actual > 0) return "ACTUAL";
  const estimated = Number(job?.billedEstimatedHours);
  if (Number.isFinite(estimated) && estimated > 0) return "ESTIMATED";
  return "NONE";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * THE hourly service line: `billedHourlyRate × billedHours`.
 *
 * Returns null — not 0 — when the job is not hourly, or is hourly but has no
 * rate or no hours yet. Null means "this job has no hourly-derived price, use
 * `Job.price`"; zero would mean "this job is worth nothing", and the two must
 * not be confused by the caller in `computeJobMoney`.
 */
export function hourlyServiceAmount(
  job: HourlyBillingFields | null | undefined
): number | null {
  if (!isHourlyBilled(job)) return null;
  const rate = Number(job?.billedHourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const hours = billedHours(job);
  if (hours === null) return null;
  return round2(rate * hours);
}

/** "4h × $60.00/hr = $240.00" — one string, so no two surfaces word it differently. */
export function hourlyLineLabel(
  job: HourlyBillingFields | null | undefined
): string | null {
  const amount = hourlyServiceAmount(job);
  if (amount === null) return null;
  const hours = billedHours(job) ?? 0;
  const rate = Number(job?.billedHourlyRate) || 0;
  return `${formatHours(hours)} × $${rate.toFixed(2)}/hr = $${amount.toFixed(2)}`;
}

/** "4h" / "2.75h" — trailing zeros trimmed, so 4.00 never prints as "4.00h". */
export function formatHours(hours: number): string {
  const n = Number(hours);
  if (!Number.isFinite(n)) return "0h";
  return `${String(Math.round(n * 100) / 100)}h`;
}

// ── Actual hours, measured from the work sessions ────────────────────────────
//
// THE RULE — AWER round 4, fix 4 (`awerfixesaug18.pdf` p4), which REVERSES the
// Stage 8 rule that used to be documented here:
//
//   Billable hours are TOTAL CREW HOURS, not elapsed hours. Two cleaners on
//   site together for three hours is SIX billable hours.
//
// Stage 8 billed the union of the crew's time ("three hours") on the reasoning
// that `billedEstimatedHours` is typed from the scheduled window and the two
// figures had to share a unit. Round 4's PDF answers that directly and settles
// it the other way: the estimate is cumulative too — "Estimated hours = 30 means
// 1 cleaner × 30h OR 2 cleaners × 15h" — so both numbers are man-hours and the
// unit still matches. Per this round's standing rule, the PDF wins. Both job
// forms now say so on the field itself, so an admin typing 30 is typing the same
// thing the clock will measure.
//
// What did NOT change, and must not: the rate is multiplied by these hours
// exactly ONCE. `hourlyServiceAmount` is `rate × hours` and there is no crew
// factor anywhere near it — the man-hours live INSIDE the hours, never as a
// second multiplication. (`postConstructionBasePrice` in service-pricing.ts is
// the one place that spells it `hours × rate × cleaners`; that is a QUOTE built
// from a per-cleaner estimate, it already produces man-hours, and it is
// therefore aligned with this rule rather than an exception to it.)
//
// The measurement itself lives in `work-sessions.ts` — per cleaner, sessions
// summed with their own breaks removed, then added across the crew — because
// fix 5 pays each cleaner from the very same per-cleaner figures. One map, two
// answers, no way for the bill and the payroll to disagree about what happened.

/** @deprecated Spelling kept for callers; `CrewSession` is the same shape. */
export type BilledSession = CrewSession;
/** @deprecated Spelling kept for callers; `CrewBreak` is the same shape. */
export type BilledBreak = CrewBreak;

/**
 * TOTAL CREW MINUTES worked on this job, breaks removed.
 *
 * An open session (no `endedAt`) counts up to `now`, matching
 * `summariseSessions` — so a live figure doesn't jump when the last cleaner
 * finally clocks out.
 */
export function billableCrewMinutes(
  sessions: readonly CrewSession[] | null | undefined,
  breaks: readonly CrewBreak[] | null | undefined = [],
  now: Date = new Date()
): number {
  return crewActiveMinutes(sessions, breaks, now);
}

/**
 * The figure written into `billedActualHours`: total crew time, rounded to the
 * nearest quarter hour (D7). Returns 0 when nothing was worked, which the
 * caller treats as "nothing to snapshot" rather than "the job billed nothing".
 */
export function billableActualHours(
  sessions: readonly CrewSession[] | null | undefined,
  breaks: readonly CrewBreak[] | null | undefined = [],
  now: Date = new Date()
): number {
  return roundBilledHours(billableCrewMinutes(sessions, breaks, now) / 60);
}
