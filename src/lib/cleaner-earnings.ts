// SINGLE SOURCE OF TRUTH for "what has this cleaner earned?" (item 2).
//
// Before this module, three places computed cleaner pay three different ways:
//   • payroll (createPayPeriod)  → computeJobPayout() tier split
//   • My Pay                     → employeePay / participants * payRateMultiplier
//                                  (both halves since retired — see fix 1, round 3)
//   • My Income (getIncomeData)  → sum of Payout rows on PAID periods only
// so a cleaner's "pending" never matched what they were actually paid, and
// "Jobs completed" only counted jobs that already sat inside a PAID period.
//
// Everything now flows through:
//   • computeJobPayShares() — the per-job pay math (used by payroll AND My Pay)
//   • getCleanerEarnings()  — the aggregate used by My Pay AND My Income
//
// Server-only (imports the db client).

import { db } from "@/db";
import { getCleanerRateInputs } from "./cleaner-rates";
import { jobPayBasis, type MoneyAddOn } from "./job-money";
import {
  computeJobPayout,
  fallbackRateInput,
  type CleanerRateInput,
} from "./pay-tiers";
import { computePayoutTotals } from "./payout-math";
import { payBasisLabel, type PayBasisKind } from "./pay-basis";
import { summariseBreaks } from "./time-tracking";
import { crewActiveMinutesByCleaner } from "./work-sessions";
import {
  currentPayPeriodRange,
  parseBusinessDate,
  type PayPeriodRange,
} from "./pay-period";

export type JobPayType = "PERCENTAGE" | "FLAT" | "HOURLY";

/** Shape every pay calculation needs from a Job row. */
export interface JobPayInput {
  id: string;
  employeeId: string | null;
  cleaners: { id: string }[];
  price: number | null;
  employeePay: number | null;
  /**
   * TRUE when `employeePay` is an AUTHORITATIVE MANUAL TEAM TOTAL rather than a
   * save-time estimate snapshot (decision D2, `Job.employeePayIsManual`). Set by
   * an admin typing into the Employee pay field and by the BookingKoala importer
   * for a CSV that carries a provider/team payment.
   *
   * When set, `computeJobPayShares` pays that figure out instead of the tier
   * math — which is what the PDF asks for ("if admin enters $88.50, use it";
   * "do not show the stored value as not used").
   *
   * Optional so the hundreds of hand-built fixtures across the verify scripts
   * still typecheck; absent reads as FALSE, i.e. exactly today's behaviour.
   */
  employeePayIsManual?: boolean | null;
  payType: string | null;
  hourlyRate: number | null;
  /**
   * @deprecated AWER round 3, fix 1. `Job.payRateMultiplier` is no longer read
   * by any pay calculation — the rating premium lives inside
   * `CleanerRateInput.multiplier`. Retained (optional) only so pre-existing
   * fixtures still typecheck; setting it has no effect on any payout.
   */
  payRateMultiplier?: number | null;
  totalTip: number | null;
  /**
   * `Job.parking` ("Transportation" in the UI). A customer-funded pass-through
   * split evenly across the crew exactly like tips (D3 / PDF fix 4: "split tips
   * and parking evenly by default"). Optional for the same fixture reason as
   * above; absent means no parking, not "unknown".
   */
  parking?: number | null;
  /**
   * The four columns `jobPayBasis()` needs to answer "what is this job worth?".
   * Optional on the INPUT type but REQUIRED in `JOB_PAY_SELECT`, which is what
   * every real caller uses — see the note there. A caller that supplies none of
   * them gets `basis = price`, i.e. the pre-fix behaviour, so a hand-built
   * fixture cannot silently produce a number no code path would.
   */
  bookingSource?: string | null;
  pricingMode?: string | null;
  subtotalAmount?: number | null;
  discountAmount?: number | null;
  addOns?: readonly MoneyAddOn[] | null;
  /**
   * Customer-side hourly billing (Stage 8). Read ONLY through `jobPayBasis`,
   * which is what makes a PERCENTAGE crew on an hourly job take their tier cut
   * of `rate × hours` rather than of a `price` column that may not have caught
   * up yet. Nothing below multiplies by them.
   *
   * NOT to be confused with `hourlyRate`/`payType` above, which are the
   * CLEANER's hourly pay. A job can be billed HOURLY and pay PERCENTAGE.
   */
  billingType?: string | null;
  billedHourlyRate?: number | null;
  billedEstimatedHours?: number | null;
  billedActualHours?: number | null;
  jobDate: Date | null;
  startTime: Date | null;
  endTime: Date | null;
  clockInTime: Date | null;
  clockOutTime: Date | null;
  /**
   * Per-cleaner manual pay overrides (JobAssignment.payAmount). Lets admin split
   * a job's pay unevenly — e.g. a $100 FLAT job paid $70 / $30 instead of
   * $50 / $50. A null payAmount means "no override, use the normal rule".
   */
  assignments?: { cleanerId: string; payAmount: number | null }[];
  /**
   * Breaks taken on this job (item 26). Deducted from worked hours so paid
   * time reflects ACTIVE work.
   *
   * `cleanerId` was added in AWER round 3 item 6: with per-cleaner hours, one
   * cleaner's lunch break must not be deducted from their teammate's time.
   */
  breaks?: {
    cleanerId?: string;
    startedAt: Date | string;
    endedAt?: Date | string | null;
  }[];
  /**
   * Work sessions (AWER round 3, item 6). A cleaner can clock out and back in,
   * so hours come from these when present; the clockInTime/clockOutTime pair
   * above is the legacy fallback for jobs that predate the table.
   */
  workSessions?: {
    cleanerId: string;
    startedAt: Date | string;
    endedAt?: Date | string | null;
  }[];
}

/**
 * Prisma select shared by payroll and the earnings aggregate.
 *
 * Stage 4a.2 added the five money columns and the add-on rows. Every pay caller
 * — payroll (`pay-period.server.ts`), My Pay, the job detail page, the pay modal
 * and `cleanerPayoutForJobs` — reads through this constant, so they all inherit
 * the corrected basis at once and none of them can be left behind on `job.price`.
 */
export const JOB_PAY_SELECT = {
  id: true,
  employeeId: true,
  employeePay: true,
  // D2 — is that column an authoritative manual team total, or a snapshot?
  employeePayIsManual: true,
  price: true,
  // The pay BASIS columns (fix 5). Without these `jobPayBasis` falls back to the
  // bare price and every add-on stays invisible to payroll.
  bookingSource: true,
  pricingMode: true,
  subtotalAmount: true,
  discountAmount: true,
  addOns: { select: { name: true, price: true, quantity: true } },
  // Stage 8: the basis of an HOURLY-billed job is `rate × hours`, so payroll
  // has to see these four or it would pay a percentage of the stale `price`
  // mirror rather than of the hours the crew actually worked.
  billingType: true,
  billedHourlyRate: true,
  billedEstimatedHours: true,
  billedActualHours: true,
  payType: true,
  hourlyRate: true,
  // payRateMultiplier is deliberately NOT selected: the money path stopped
  // reading it in AWER round 3, fix 1, and the SQL no longer asking for it is
  // the clearest statement that nothing here depends on it.
  totalTip: true,
  // D3 — the second customer-funded pass-through, split like tips.
  parking: true,
  jobDate: true,
  startTime: true,
  endTime: true,
  clockInTime: true,
  clockOutTime: true,
  cleaners: { select: { id: true } },
  assignments: { select: { cleanerId: true, payAmount: true } },
  breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },
  workSessions: {
    select: { cleanerId: true, startedAt: true, endedAt: true },
  },
} as const;

/** Statuses payroll actually pays for. Estimates must use the same set. */
export const PAYABLE_JOB_STATUSES = ["COMPLETED", "PAID"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Who actually gets paid for this job: the lead (`employeeId`) plus every
 * assigned cleaner, de-duplicated.
 *
 * GUARD (fix list items 3 + 4): `Job.employeeId` is meant to be the job's LEAD
 * CLEANER — that's how `bulkAssignCleaner`, `claimJob` and the cleaner app's
 * my-jobs query all treat it. The admin job modal used to stamp it with the
 * ACTING ADMIN instead, which had two silent money consequences:
 *
 *   • a job with ONE cleaner became a TWO-person job, dropping the payout from
 *     the cleaner's full rate to a proportional slice of the 50% split pool
 *     ($112 at 45% paid $29.65 instead of $50.40); and
 *   • a job with NO cleaner paid the admin outright.
 *
 * The write side is fixed in saveJob, but historical rows still carry the bad
 * value, so an ADMIN/OWNER who is not ALSO an explicitly assigned cleaner (via
 * the `cleaners` relation or a JobAssignment row) is never a payable
 * participant. An owner who genuinely works jobs is assigned like anyone else
 * and is unaffected.
 *
 * `rates` is optional so pure callers keep working; the role check is simply
 * skipped when it isn't supplied.
 */
export function jobParticipantIds(
  job: JobPayInput,
  rates?: Map<string, CleanerRateInput>
): string[] {
  const explicit = new Set(
    [
      ...job.cleaners.map((c) => c.id),
      ...(job.assignments ?? []).map((a) => a.cleanerId),
    ].filter((id): id is string => !!id)
  );

  const lead = job.employeeId;
  if (lead && !explicit.has(lead)) {
    const role = rates?.get(lead)?.role;
    if (role === "ADMIN" || role === "OWNER") {
      return Array.from(explicit);
    }
  }

  return Array.from(
    new Set([lead, ...explicit].filter((id): id is string => !!id))
  );
}

/** Hours worked on the job (clock times win; scheduled times are the fallback). */
export function jobWorkedHours(job: JobPayInput): number {
  const start = job.clockInTime ?? job.startTime;
  const end = job.clockOutTime ?? job.endTime;
  if (!start || !end) return 0;
  const elapsedHours = Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000
  );
  // Breaks are ACTIVE-time deductions (awer_fixes.pdf item 26): "break time
  // should not inflate total active work time". Hourly pay bills these hours,
  // so a lunch break must not be paid to the cleaner or billed to the customer.
  const breakHours = summariseBreaks(job.breaks).minutes / 60;
  return Math.max(0, elapsedHours - breakHours);
}

/**
 * ONE cleaner's hours on one job (AWER round 3, item 6).
 *
 * Sums THEIR sessions and deducts THEIR breaks, allocated by interval overlap.
 * A cleaner who worked 9–11 and came back 3–4 gets three hours, which the
 * single clockIn/clockOut pair could not express: it would have said seven.
 *
 * FALLBACK, and why it matters: a job with no session rows — every job that
 * predates the JobWorkSession table, and any job whose backfill has not been
 * committed — falls back to exactly the old calculation, the job-level span
 * divided evenly. So nothing about historical payroll moves.
 *
 * NOTE ON MONEY: as of AWER round 4 (fix 5) this is no longer reporting-only on
 * an HOURLY job — `computeJobPayShares` pays these very hours × `hourlyRate`.
 * On every other pay type it stays what it was: a reported figure that no payout
 * reads. Verified against live data before the round-3 switch: 0 multi-cleaner
 * jobs had clock pairs, so the delta was 8.4h → 8.4h (probe-stage5.ts).
 *
 * The measurement is `crewActiveMinutesByCleaner` (src/lib/work-sessions.ts) —
 * THE same per-cleaner map the customer's `billedActualHours` is summed from, so
 * "billed 6h, paid 3h" is not expressible.
 */
export function cleanerWorkedHours(
  job: JobPayInput,
  cleanerId: string,
  participantCount: number
): number {
  const minutes = crewActiveMinutesByCleaner(job.workSessions, job.breaks).get(
    cleanerId
  );

  // No sessions for this cleaner → the legacy shape, unchanged.
  if (minutes === undefined) {
    return participantCount > 0 ? jobWorkedHours(job) / participantCount : 0;
  }

  return minutes / 60;
}

/**
 * The per-cleaner clocked hours an HOURLY-PAID job is settled from, or null when
 * the clock cannot answer (AWER round 4, fix 5).
 *
 * Null means "the stored `employeePay` stands" and covers three cases, each on
 * purpose:
 *   • not HOURLY pay — FLAT and PERCENTAGE are none of this function's business;
 *   • no `hourlyRate` — there is nothing to multiply by, which is exactly the
 *     state fix 5's other half (the modal resetting the field) used to leave
 *     jobs in;
 *   • no work sessions — the job was never clocked, so `employeePay` is still
 *     the save-time ESTIMATE from the scheduled window and must stay it. A
 *     legacy job-level clock pair deliberately does NOT qualify: it carries no
 *     per-cleaner record, and `jobWorkedHours` falls back to SCHEDULED times
 *     when the pair is empty, so treating it as clock evidence would invent pay
 *     out of the calendar.
 *
 * A cleaner on the job with no sessions of their own maps to ZERO hours rather
 * than to a share of the job's span: on an hourly job the clock is the record,
 * and a silent schedule-derived payout for someone who never clocked in is the
 * kind of invisible money this module exists to remove. The basis label says
 * "0h clocked", so an admin sees it and either fixes the clock or types a
 * per-cleaner override — both of which win over this.
 */
export function hourlyClockedHours(
  job: JobPayInput,
  participantIds: readonly string[]
): { rate: number; hoursById: Map<string, number> } | null {
  if (((job.payType as JobPayType) ?? "PERCENTAGE") !== "HOURLY") return null;
  const rate = Number(job.hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if ((job.workSessions ?? []).length === 0) return null;

  const minutes = crewActiveMinutesByCleaner(job.workSessions, job.breaks);
  const hoursById = new Map<string, number>();
  for (const id of participantIds) {
    hoursById.set(id, (minutes.get(id) ?? 0) / 60);
  }
  return { rate, hoursById };
}

/**
 * The TEAM TOTAL an HOURLY job owes from the clock — Σ (per-cleaner hours ×
 * rate) — or null when the clock cannot answer (see `hourlyClockedHours`).
 *
 * This is what `snapshotHourlyEmployeePay` writes into `Job.employeePay` at
 * clock-out, and it is the sum of exactly the shares `computeJobPayShares`
 * hands out, because both call the function above.
 */
export function hourlyTeamPayFromClock(
  job: JobPayInput,
  rates?: Map<string, CleanerRateInput>
): number | null {
  const participantIds = jobParticipantIds(job, rates);
  if (participantIds.length === 0) return null;
  const clock = hourlyClockedHours(job, participantIds);
  if (!clock) return null;
  let total = 0;
  for (const hours of clock.hoursById.values()) total += hours * clock.rate;
  return round2(total);
}

/** The instant a job counts against for period/year bucketing. */
export function jobEffectiveDate(job: JobPayInput): Date | null {
  const d = job.jobDate ?? job.startTime;
  return d ? new Date(d) : null;
}

export interface JobPayShare {
  /**
   * What the cleaner earns for the WORK, before pass-throughs. This is the only
   * component that is a company labour cost — tips and parking below are the
   * customer's money in transit.
   */
  base: number;
  /**
   * @deprecated Always equal to `base`. The rating multiplier is now folded
   * into the cleaner's RATE (src/lib/pay-tiers.ts) instead of being applied to
   * the finished amount, and `Job.payRateMultiplier` is no longer read — so
   * there is no "after multiplier" step left. Kept for one release so callers
   * migrate to `base` deliberately. Do not use in new code.
   */
  afterMultiplier: number;
  /** This cleaner's slice of the job's tips. Never multiplied by any rate. */
  tip: number;
  /**
   * This cleaner's slice of `Job.parking` ("Transportation"), split evenly
   * exactly like tips (PDF fix 4: "split tips and parking evenly by default").
   *
   * Before Stage 4b this money was subtracted from company profit as a
   * transportation EXPENSE and then paid to nobody. It is customer-funded, so
   * it is neither company revenue nor a company cost — it passes through.
   */
  parking: number;
  /** What the cleaner is actually paid for this job: `base + tip + parking`. */
  total: number;
  /** Per-person share of the worked hours. */
  hours: number;
  /**
   * Which rule produced `base` (fix 5). Decided here, beside the amount, and
   * carried rather than re-derived per screen — re-deriving it is how the pay
   * modal, the job page and payroll would come to disagree about a figure they
   * already agree on. The vocabulary lives in `./pay-basis`, which is pure so
   * client components can read the labels too.
   */
  basis: PayBasisKind;
  /**
   * That rule in words, ready to print: "Hourly — 3.5h clocked × $25.00/h",
   * "Percentage — tier rate", "Manual — team total, split evenly".
   */
  basisLabel: string;
}

/** The zero share, so the several "no participant" fallbacks cannot drift. */
export const EMPTY_PAY_SHARE: JobPayShare = {
  base: 0,
  afterMultiplier: 0,
  tip: 0,
  parking: 0,
  total: 0,
  hours: 0,
  basis: "PERCENTAGE",
  basisLabel: "No pay calculated — nobody is assigned to this job.",
};

/**
 * THE per-job pay calculation. Payroll and every estimate must call this.
 *
 *   • MANUAL     — `employeePayIsManual` (D2): `employeePay` is the TEAM TOTAL
 *     the admin typed or BookingKoala paid, split evenly. Beats the tier math
 *     until an admin clears the flag. This is the PDF's "if admin enters $88.50,
 *     use it".
 *   • PERCENTAGE — each cleaner earns their own rating-based rate on the job's
 *     PAY BASIS (src/lib/pay-tiers.ts). Paired jobs no longer halve anything.
 *     Legacy jobs with no basis fall back to an even split of employeePay.
 *   • FLAT       — employeePay is the agreed TEAM TOTAL, split between the crew.
 *   • HOURLY     — each cleaner earns THEIR OWN clocked hours × `hourlyRate`
 *     (round 4, fix 5). Until anything is clocked, `employeePay` is still the
 *     save-time estimate from the scheduled window and is split evenly, labelled
 *     as an estimate. See `hourlyClockedHours`.
 *
 * Every share carries `basis` / `basisLabel` saying WHICH of those rules paid
 * it, so the pay modal, the Financials tab and payroll can all print the reason
 * without re-deriving it and drifting apart (fix 5's "UI states which basis is
 * in use").
 *
 * ## The basis moved (fix 5, Stage 4a.3)
 *
 * The PERCENTAGE path used to pay a fraction of `job.price` — the BASE service
 * line. Every add-on and every custom extra charge was therefore work the crew
 * did for nothing: the PDF's page-5 job billed $171 and paid off $100. It now
 * pays off `jobPayBasis(job)`, the same active value every price surface prints
 * (base + add-ons, or the stored override total), minus nothing for discounts
 * per decision D5.
 *
 * Tips AND parking are always split evenly across participants and are NEVER
 * multiplied by anyone's rate — they are the customer's money passing through.
 *
 * This function applies no multiplier of its own (awerfixes.pdf item 1). The
 * rating premium is already baked into each cleaner's RATE by
 * src/lib/cleaner-rates.ts, which is what lets manual overrides, FLAT totals
 * and HOURLY amounts pass through exactly as the admin typed them.
 */
export function computeJobPayShares(
  job: JobPayInput,
  rates: Map<string, CleanerRateInput>
): Map<string, JobPayShare> {
  const participantIds = jobParticipantIds(job, rates);
  const result = new Map<string, JobPayShare>();
  if (participantIds.length === 0) return result;

  const payType = (job.payType as JobPayType) ?? "PERCENTAGE";
  const tipShare = (job.totalTip || 0) / participantIds.length;
  // Parking rides in the same lane as tips: even split, no rate applied. It used
  // to be a company transportation expense that reached no cleaner at all.
  const parkingShare = Math.max(0, job.parking || 0) / participantIds.length;

  const rateList: CleanerRateInput[] = participantIds.map(
    (id) => rates.get(id) ?? fallbackRateInput(id)
  );

  // THE basis (fix 5). `job.price` is the base service line; this is what the
  // job is actually worth — base + add-ons, or the stored override total.
  const payBasis = jobPayBasis(job);
  const usePriceModel = payBasis > 0;
  const payout = computeJobPayout(payBasis, rateList);
  const tierAmountById = new Map(payout.shares.map((s) => [s.id, s.amount]));

  // D2 — an authoritative manual TEAM TOTAL supersedes the tier math on a
  // PERCENTAGE job. FLAT/HOURLY already treat `employeePay` this way, so the
  // flag changes nothing for them; it is checked here only so the two paths
  // share one branch below rather than two spellings of the same rule.
  const manualTeamTotal = job.employeePayIsManual === true;

  // Manual per-cleaner overrides (JobAssignment.payAmount). An override always
  // wins for that cleaner.
  const overrideById = new Map<string, number>();
  for (const a of job.assignments ?? []) {
    if (a.payAmount != null && participantIds.includes(a.cleanerId)) {
      overrideById.set(a.cleanerId, a.payAmount);
    }
  }

  // ── HOURLY, settled from the clock (AWER round 4, fix 5) ──────────────────
  //
  // The PDF: "pay = total clocked hours × cleaner hourly rate, all sessions
  // summed". Before this, an HOURLY job's `employeePay` was computed ONCE at
  // save time from the SCHEDULED window and never revisited — a cleaner who
  // stayed two hours late was paid for the hours nobody worked. Now each cleaner
  // earns THEIR OWN clocked hours × the job's rate, and the team total is the
  // sum of those (which is what `snapshotHourlyEmployeePay` stores back).
  //
  // Null when the clock cannot answer — see `hourlyClockedHours`, which is also
  // what the stored-column snapshot calls, so the two cannot diverge. A manual
  // team total (D2) is checked first below and still wins, as does a per-cleaner
  // override: an admin's stated figure beats a measurement, always.
  const hourlyClock = manualTeamTotal
    ? null
    : hourlyClockedHours(job, participantIds);

  // FLAT / HOURLY / MANUAL: `employeePay` is the TEAM TOTAL for the job, divided
  // between the assigned cleaners — NOT paid to each of them (client decision).
  // Anyone with a manual override takes their fixed amount off the top; whoever
  // is left splits the remainder evenly, so the crew can never be paid more than
  // the agreed total. D2 reuses this remainder logic verbatim for a manual
  // PERCENTAGE job, which is exactly the PDF's $88.55 → $44.28 / $44.27.
  const teamTotal = job.employeePay || 0;
  const overriddenParticipants = participantIds.filter((id) =>
    overrideById.has(id)
  );
  const unoverriddenCount =
    participantIds.length - overriddenParticipants.length;
  const overriddenSum = overriddenParticipants.reduce(
    (s, id) => s + (overrideById.get(id) ?? 0),
    0
  );
  // Split the remainder to the CENT, not to the float.
  //
  // `teamTotal / n` rounded per person overpays an odd total: $88.55 across two
  // cleaners is $44.275 each, which round2 turns into $44.28 + $44.28 = $88.56 —
  // a cent the company never agreed to, on every such job, forever. The client's
  // own screenshot names the right answer ($44.28 / $44.27), so the leftover
  // cents go to the first cleaners in participant order and the crew total is
  // the agreed figure exactly. Even splits ($100 / 2) are untouched.
  const remainderCents = Math.max(
    0,
    Math.round((teamTotal - overriddenSum) * 100)
  );
  const perPersonCents =
    unoverriddenCount > 0 ? Math.floor(remainderCents / unoverriddenCount) : 0;
  const extraCents =
    unoverriddenCount > 0 ? remainderCents % unoverriddenCount : 0;
  // Same idea for the legacy no-basis path, which splits the WHOLE team total.
  const legacyCents = Math.max(0, Math.round(teamTotal * 100));
  const legacyPerPersonCents = Math.floor(legacyCents / participantIds.length);
  const legacyExtraCents = legacyCents % participantIds.length;

  let unoverriddenSeen = 0;
  for (const [index, id] of participantIds.entries()) {
    let base: number;
    let basis: PayBasisKind;
    let basisDetail: { hours?: number; rate?: number } = {};
    const override = overrideById.get(id);
    if (override != null) {
      // MANUAL OVERRIDE — exactly the amount the admin promised this cleaner,
      // scaled by NOTHING (awerfixes.pdf item 1: "manual/custom payout should
      // still override"). This used to be multiplied by Job.payRateMultiplier,
      // which was invisible while that factor was pinned at 1.0 and wrong the
      // day it wasn't.
      base = override;
      basis = "MANUAL_CLEANER";
    } else if (hourlyClock) {
      // HOURLY FROM THE CLOCK (round 4, fix 5) — this cleaner's own sessions,
      // breaks deducted, times the job's cleaner rate. Not a slice of a team
      // total: two cleaners who each worked 3h at $25 are paid $75 each, and the
      // $150 team figure is the CONSEQUENCE rather than the input.
      const hours = hourlyClock.hoursById.get(id) ?? 0;
      base = hours * hourlyClock.rate;
      basis = "HOURLY_CLOCK";
      basisDetail = { hours, rate: hourlyClock.rate };
    } else if (payType === "FLAT" || payType === "HOURLY" || manualTeamTotal) {
      // employeePay is an agreed TEAM TOTAL — a manual amount too. Untouched by
      // any rate. `manualTeamTotal` is decision D2: on a PERCENTAGE job an admin
      // (or the BookingKoala CSV) has stated the crew's pay outright, and the
      // PDF is explicit that it must be honoured rather than shown as unused.
      base =
        (perPersonCents + (unoverriddenSeen < extraCents ? 1 : 0)) / 100;
      unoverriddenSeen += 1;
      basis = manualTeamTotal
        ? "MANUAL_TEAM"
        : payType === "HOURLY"
          ? // HOURLY with nothing clocked yet: `employeePay` is still saveJob's
            // estimate from the scheduled window. Labelled as an estimate rather
            // than dressed up as a measurement.
            "HOURLY_ESTIMATE"
          : "FLAT";
    } else if (usePriceModel) {
      // PERCENTAGE — the rating multiplier is ALREADY inside the rate that
      // computeJobPayout used (tier base x multiplier). Applying it again here
      // would pay the rating premium twice. The BASIS is the job's active value
      // (base + add-ons, or the override total), not the bare price — fix 5.
      base = tierAmountById.get(id) ?? 0;
      basis = "PERCENTAGE";
    } else {
      // Legacy PERCENTAGE row with no basis at all: employeePay is whatever the
      // admin or the BookingKoala importer recorded — also a manual amount.
      // Split evenly, unscaled; multiplying an imported provider payment by a
      // rating premium would invent money no rate ever justified.
      base =
        (legacyPerPersonCents + (index < legacyExtraCents ? 1 : 0)) / 100;
      basis = "LEGACY";
    }
    result.set(id, {
      base: round2(base),
      // Deprecated alias — see JobPayShare. Equal to `base` by construction.
      afterMultiplier: round2(base),
      tip: round2(tipShare),
      // D3 — the customer-funded parking share, split exactly like the tip and
      // multiplied by nothing.
      parking: round2(parkingShare),
      // `base` unrounded here, exactly as before, so no double-rounding is
      // introduced and FLAT thirds don't shift by a cent.
      total: round2(base + tipShare + parkingShare),
      // Each cleaner's OWN hours when sessions exist; the old even split of
      // the job span otherwise (see cleanerWorkedHours). On an HOURLY job
      // settled from the clock this is the very figure `base` was computed
      // from — including the 0 of a cleaner who never clocked in, so the row
      // cannot show hours the pay disagrees with.
      hours: hourlyClock
        ? hourlyClock.hoursById.get(id) ?? 0
        : cleanerWorkedHours(job, id, participantIds.length),
      basis,
      basisLabel: payBasisLabel(basis, basisDetail),
    });
  }
  return result;
}

/** One cleaner's pay for one job (convenience wrapper). */
export function cleanerJobPay(
  job: JobPayInput,
  rates: Map<string, CleanerRateInput>,
  employeeId: string
): JobPayShare {
  return computeJobPayShares(job, rates).get(employeeId) ?? EMPTY_PAY_SHARE;
}

export type PeriodStatus = "OPEN" | "DRAFT" | "APPROVED" | "PAID" | "CANCELLED";

export interface CleanerPeriodSummary {
  startDate: Date;
  endDate: Date;
  /** "OPEN" = the live current week; no PayPeriod row exists for it yet. */
  status: PeriodStatus;
  /**
   * Everything the period earned before adjustments: the WORK plus both
   * customer-funded pass-throughs (tips and, since Stage 4b, parking). Same
   * three components `JobPayShare.total` carries and the same figure
   * `generatePayPeriodForWeek` writes into `Payout.baseAmount`, so the live week
   * and the drafted week are the same number.
   */
  baseAmount: number;
  adjustments: number;
  deductions: number;
  reimbursements: number;
  finalAmount: number;
  jobCount: number;
  totalHours: number;
  /** True when the figures are computed live from jobs, not from a Payout row. */
  isLive: boolean;
}

export interface CleanerEarnings {
  year: number;
  /** Money owed but not yet paid: open payouts + completed jobs with no period. */
  pendingAmount: number;
  /** The portion of pendingAmount that comes from jobs no pay period covers. */
  unprocessedEarnings: number;
  /** All-time net of PAID payouts (what funds the wallet). */
  walletBalance: number;
  /** PAID payouts for work in `year` (bucketed by the period's END date). */
  paidYTD: number;
  /** paidYTD + everything still pending for work performed in `year`. */
  earnedYTD: number;
  grossYTD: number;
  deductionsYTD: number;
  adjustmentsYTD: number;
  reimbursementsYTD: number;
  paidPayoutCount: number;
  /** ALL completed/paid jobs in `year` — not just the ones inside PAID periods. */
  jobsCompletedYTD: number;
  /** Per-person hours on those jobs. */
  totalHoursYTD: number;
  /** The period that CONTAINS today, live-computed when no PayPeriod row exists. */
  currentPeriod: CleanerPeriodSummary | null;
  currentRange: PayPeriodRange;
}

function yearBounds(year: number): { start: Date; end: Date } {
  const start =
    parseBusinessDate(`${year}-01-01`) ?? new Date(Date.UTC(year, 0, 1));
  const end =
    parseBusinessDate(`${year + 1}-01-01`) ??
    new Date(Date.UTC(year + 1, 0, 1));
  return { start, end };
}

/**
 * Everything My Pay and My Income need, computed once, the same way.
 * Callers are responsible for authorization (employeeId must be the caller or
 * the caller must be an admin).
 */
export async function getCleanerEarnings(
  employeeId: string,
  year: number = new Date().getFullYear(),
  now: Date = new Date()
): Promise<CleanerEarnings> {
  const { start: yearStart, end: yearEnd } = yearBounds(year);
  const currentRange = currentPayPeriodRange(now);

  const [payouts, jobs] = await Promise.all([
    db.payout.findMany({
      where: { employeeId },
      include: { payPeriod: true },
      orderBy: { payPeriod: { startDate: "desc" } },
    }),
    db.job.findMany({
      where: {
        deletedAt: null,
        status: { in: [...PAYABLE_JOB_STATUSES] },
        OR: [{ employeeId }, { cleaners: { some: { id: employeeId } } }],
      },
      select: JOB_PAY_SELECT,
    }),
  ]);

  // Rates for every participant on those jobs — the tier split needs the whole
  // team, not just the viewer.
  const rates = await getCleanerRateInputs(
    jobs.flatMap((j) => [j.employeeId, ...j.cleaners.map((c) => c.id)])
  );

  // ── Payout-derived figures ────────────────────────────────────────────────
  const inYear = (d: Date) => d >= yearStart && d < yearEnd;

  const paidPayouts = payouts.filter((p) => p.payPeriod.status === "PAID");
  const openPayouts = payouts.filter(
    (p) =>
      p.payPeriod.status === "DRAFT" || p.payPeriod.status === "APPROVED"
  );

  // Year buckets follow the WORK (period end date), not paidAt — otherwise
  // December work paid in January lands in the wrong year.
  const paidThisYear = paidPayouts.filter((p) =>
    inYear(new Date(p.payPeriod.endDate))
  );

  // Payout money is read through the canonical helper rather than the stored
  // column so a row written before the $0 floor landed can never show a cleaner
  // a negative wallet or pending balance (fix list item 1).
  const payoutFinal = (p: { baseAmount: number; adjustments: number; deductions: number; reimbursements: number }) =>
    computePayoutTotals(p).final;

  const walletBalance = paidPayouts.reduce((s, p) => s + payoutFinal(p), 0);
  const paidYTD = paidThisYear.reduce((s, p) => s + payoutFinal(p), 0);
  const grossYTD = paidThisYear.reduce((s, p) => s + p.baseAmount, 0);
  const deductionsYTD = paidThisYear.reduce((s, p) => s + p.deductions, 0);
  const adjustmentsYTD = paidThisYear.reduce((s, p) => s + p.adjustments, 0);
  const reimbursementsYTD = paidThisYear.reduce(
    (s, p) => s + p.reimbursements,
    0
  );
  const pendingFromPeriods = openPayouts.reduce(
    (s, p) => s + payoutFinal(p),
    0
  );
  const pendingThisYearFromPeriods = openPayouts
    .filter((p) => inYear(new Date(p.payPeriod.endDate)))
    .reduce((s, p) => s + payoutFinal(p), 0);

  // ── Job-derived figures ───────────────────────────────────────────────────
  // A job is "processed" once a live pay period the cleaner has a payout in
  // covers its date; anything else is still owed to them. A CANCELLED period
  // pays nothing, so its jobs go back to pending instead of disappearing.
  const coveredRanges = payouts
    .filter((p) => p.payPeriod.status !== "CANCELLED")
    .map((p) => ({
      start: new Date(p.payPeriod.startDate).getTime(),
      end: new Date(p.payPeriod.endDate).getTime(),
    }));
  const isCovered = (d: Date) => {
    const t = d.getTime();
    return coveredRanges.some((r) => t >= r.start && t <= r.end);
  };

  let unprocessedEarnings = 0;
  let unprocessedThisYear = 0;
  let jobsCompletedYTD = 0;
  let totalHoursYTD = 0;
  let liveBase = 0;
  let liveTips = 0;
  // D3 — the parking pass-through is money the cleaner is owed, so it belongs in
  // the live current-week figure exactly like tips. Left out, My Pay would quote
  // a smaller number than the payout row payroll then writes from `share.total`.
  let liveParking = 0;
  let liveJobs = 0;
  let liveHours = 0;

  for (const job of jobs) {
    const share = cleanerJobPay(job as JobPayInput, rates, employeeId);
    const date = jobEffectiveDate(job as JobPayInput);
    if (!date) continue;

    if (inYear(date)) {
      jobsCompletedYTD += 1;
      totalHoursYTD += share.hours;
    }

    if (!isCovered(date)) {
      unprocessedEarnings += share.total;
      if (inYear(date)) unprocessedThisYear += share.total;
    }

    if (
      date >= currentRange.start &&
      date <= currentRange.end
    ) {
      liveBase += share.base;
      liveTips += share.tip;
      liveParking += share.parking;
      liveJobs += 1;
      liveHours += share.hours;
    }
  }

  const pendingAmount = round2(pendingFromPeriods + unprocessedEarnings);
  const earnedYTD = round2(
    paidYTD + pendingThisYearFromPeriods + unprocessedThisYear
  );

  // ── Current period ────────────────────────────────────────────────────────
  // The period that CONTAINS now — never an arbitrary old DRAFT. When payroll
  // hasn't created this week's PayPeriod yet, show the live week instead.
  const currentPayout =
    payouts.find((p) => {
      const s = new Date(p.payPeriod.startDate).getTime();
      const e = new Date(p.payPeriod.endDate).getTime();
      const t = now.getTime();
      return t >= s && t <= e && p.payPeriod.status !== "CANCELLED";
    }) ?? null;

  const currentPeriod: CleanerPeriodSummary | null = currentPayout
    ? {
        startDate: new Date(currentPayout.payPeriod.startDate),
        endDate: new Date(currentPayout.payPeriod.endDate),
        status: currentPayout.payPeriod.status as PeriodStatus,
        baseAmount: currentPayout.baseAmount,
        adjustments: currentPayout.adjustments,
        deductions: currentPayout.deductions,
        reimbursements: currentPayout.reimbursements,
        finalAmount: payoutFinal(currentPayout),
        jobCount: currentPayout.jobCount,
        totalHours: currentPayout.totalHours,
        isLive: false,
      }
    : {
        startDate: currentRange.start,
        endDate: currentRange.end,
        status: "OPEN",
        // base + tip + parking — the same three components `share.total` carries
        // and the same figure `generatePayPeriodForWeek` will write into the
        // payout row, so the live week and the drafted week agree to the cent.
        baseAmount: round2(liveBase + liveTips + liveParking),
        adjustments: 0,
        deductions: 0,
        reimbursements: 0,
        finalAmount: round2(liveBase + liveTips + liveParking),
        jobCount: liveJobs,
        totalHours: round2(liveHours),
        isLive: true,
      };

  return {
    year,
    pendingAmount,
    unprocessedEarnings: round2(unprocessedEarnings),
    walletBalance: round2(walletBalance),
    paidYTD: round2(paidYTD),
    earnedYTD,
    grossYTD: round2(grossYTD),
    deductionsYTD: round2(deductionsYTD),
    adjustmentsYTD: round2(adjustmentsYTD),
    reimbursementsYTD: round2(reimbursementsYTD),
    paidPayoutCount: paidThisYear.length,
    jobsCompletedYTD,
    totalHoursYTD: round2(totalHoursYTD),
    currentPeriod,
    currentRange,
  };
}
