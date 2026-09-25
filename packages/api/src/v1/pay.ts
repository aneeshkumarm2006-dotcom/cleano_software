// My pay: the cleaner's balance, earnings, pay periods, withdrawals, and what
// each job paid. The web equivalents are /cleaners/my-pay (page.tsx and
// MyPayClient), getCleanerEarnings (apps/web/src/lib/cleaner-earnings.ts),
// requestWithdrawal and getPayBreakdown's CLEANER payload.
//
// SCOPE. Every endpoint here is about the CALLER's own money and nobody
// else's. The server derives the employee from the session, never from the
// request: there is no employee id in any path, query or body, so there is
// nothing to tamper with. A pay period, payout, withdrawal or job that isn't
// the caller's answers 404, the same as one that doesn't exist.
//
// WHAT IS NEVER HERE: the client's price or charges, discounts, the cleaner's
// tier or percentage, the split-pool math, other cleaners' pay, internal payout
// notes, or the payment method the office chose. getPayBreakdown's redaction
// rule (only what the cleaner is paid) holds for every response in this file.
//
// Money is integer cents. The web stores dollars as floats; the server
// converts each figure once, with Math.round(dollars * 100), AFTER summing in
// the web's own helpers, so the app shows the same cents the web does.
import { z } from "zod";

import { Cents, Instant, LocalDate, openEnum, page } from "./common";

/**
 * A pay period's state. OPEN is the live current week that payroll hasn't cut
 * yet (no PayPeriod row); the rest are PayPeriodStatus.
 */
export const PAY_PERIOD_STATUSES = ["OPEN", "DRAFT", "APPROVED", "PAID", "CANCELLED"] as const;

/** A withdrawal's state. The app words them "Requested", "Approved", "Declined", "Paid". */
export const WITHDRAWAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const;

/** Which rule produced a job's pay. A copy of @bookmops/core/pay's PayBasisKind. */
export const PAY_BASES = [
  "MANUAL_CLEANER",
  "MANUAL_TEAM",
  "HOURLY_CLOCK",
  "HOURLY_ESTIMATE",
  "FLAT",
  "PERCENTAGE",
  "LEGACY",
] as const;

/** Whether the cleaner's rating is lifting their pay on a job. */
export const RATING_BOOST_STATES = ["APPLIED", "LOCKED", "NOT_APPLICABLE"] as const;

/** Why the rating doesn't apply: an amount set by hand, a flat total, or hourly pay. */
export const RATING_BOOST_REASONS = ["FIXED_AMOUNT", "FLAT", "HOURLY"] as const;

/**
 * Why a withdrawal was refused: the `error.code`. The app words each one and
 * falls back to the server's `message` for any code it doesn't know.
 */
export const WITHDRAWAL_REFUSALS = [
  /** More than the available balance, as the server computed it just now. */
  "INSUFFICIENT_BALANCE",
  /** Zero, negative, or below the minimum. */
  "AMOUNT_TOO_SMALL",
] as const;
export type WithdrawalRefusal = (typeof WITHDRAWAL_REFUSALS)[number];

/** One pay period, as this cleaner was (or will be) paid for it. */
export const PayPeriodSummary = z.object({
  /**
   * The payout's id, or "current" for the live week (no payout row yet). Only
   * ever an id of one of the caller's own payouts.
   */
  id: z.string(),
  /** First and last day, in the company's zone. */
  startDate: LocalDate,
  endDate: LocalDate,
  status: openEnum(PAY_PERIOD_STATUSES),
  /** Computed live from jobs, not from a payout: an estimate until payroll runs. */
  isLive: z.boolean(),
  /** Work plus tips and parking, before adjustments. */
  baseCents: Cents,
  adjustmentsCents: Cents,
  /** A positive number: shown as taken away. */
  deductionsCents: Cents,
  reimbursementsCents: Cents,
  /** What the period pays: through computePayoutTotals, never below zero. */
  finalCents: Cents,
  jobCount: z.number().int(),
  hours: z.number(),
  paidAt: Instant.nullable(),
});
export type PayPeriodSummary = z.infer<typeof PayPeriodSummary>;

/**
 * GET /api/v1/pay — the My pay screen, in one request.
 *
 * Access: `staff` (EMPLOYEE, FIELD_LEAD), active, password settled. Scoped to
 * the caller (see the top of this file). Every figure comes from
 * getCleanerEarnings(caller, year, now) and getCleanerRatingSummary(caller),
 * the same computations the web page uses, so the two can't disagree. `year`
 * and "now" are the company's, not the server's.
 */
export const PayResponse = z.object({
  balance: z.object({
    /**
     * What the cleaner may withdraw right now: PAID payouts minus every
     * withdrawal that isn't REJECTED, never below zero. The SAME formula
     * POST /pay/withdrawals checks against.
     */
    availableCents: Cents,
    /** Owed but not paid yet: open payouts plus completed jobs no period covers. */
    pendingCents: Cents,
    /** The part of `pendingCents` from jobs no pay period covers yet. */
    unprocessedCents: Cents,
  }),
  /** The period containing today, or null. */
  currentPeriod: PayPeriodSummary.nullable(),
  yearToDate: z.object({
    year: z.number().int(),
    /** Paid plus still pending, for work done this year. */
    earnedCents: Cents,
    paidCents: Cents,
    jobsCompleted: z.number().int(),
    hours: z.number(),
  }),
  /** @bookmops/core/rating's summary. `average` is null with no reviews: never a made-up score. */
  rating: z.object({
    average: z.number().nullable(),
    count: z.number().int(),
  }),
  /** The rules for a withdrawal, from the server, so the app never hard-codes them. */
  withdrawal: z.object({
    /** The instant-payout fee, in basis points: 500 is 5%. */
    feeBasisPoints: z.number().int(),
    /** The smallest request the server accepts. */
    minimumCents: Cents,
    /** How long a payout takes, for the person holding the phone: "Sent within 0–3 hours, during working hours." */
    timing: z.string().nullable(),
  }),
});
export type PayResponse = z.infer<typeof PayResponse>;

/**
 * GET /api/v1/pay/payouts?cursor=… — the caller's pay periods, newest first:
 * paid, approved, draft and cancelled payouts, from Payout rows whose
 * employeeId is the caller. The live week is in GET /pay, not here.
 */
export const PayoutsResponse = page(PayPeriodSummary);
export type PayoutsResponse = z.infer<typeof PayoutsResponse>;

export const Withdrawal = z.object({
  id: z.string(),
  /** Taken from the available balance. */
  amountCents: Cents,
  /** The fee, and what reaches the cleaner. Null on rows older than the fee. */
  feeCents: Cents.nullable(),
  netCents: Cents.nullable(),
  status: openEnum(WITHDRAWAL_STATUSES),
  requestedAt: Instant,
  processedAt: Instant.nullable(),
  /** The note the cleaner sent with the request. */
  note: z.string().nullable(),
});
export type Withdrawal = z.infer<typeof Withdrawal>;

/**
 * GET /api/v1/pay/withdrawals?cursor=… — the caller's withdrawal requests,
 * newest first. Withdrawal rows whose employeeId is the caller; never the
 * payment method (the office's decision) or anyone else's requests.
 */
export const WithdrawalsResponse = page(Withdrawal);
export type WithdrawalsResponse = z.infer<typeof WithdrawalsResponse>;

/**
 * POST /api/v1/pay/withdrawals
 * Idempotency-Key: the body's `clientEventId`.
 *
 * Access as GET /pay. The amount only: how it's paid out is the office's
 * decision (paymentMethod stays null until they process it).
 *
 * THE SERVER RE-VALIDATES THE AMOUNT; the app's check is only for the person.
 * Inside ONE database transaction, holding a lock that serialises the caller's
 * withdrawals (a per-employee advisory lock, or SERIALIZABLE isolation with a
 * retry), it must:
 *   1. recompute the available balance from the caller's own rows: PAID
 *      payouts through summarisePayouts (clamped, so a legacy negative payout
 *      can't shrink it), minus every PENDING, APPROVED and COMPLETED
 *      withdrawal;
 *   2. refuse `amountCents` below `minimumCents` (400 AMOUNT_TOO_SMALL) or
 *      above that balance (409 INSUFFICIENT_BALANCE, with the balance in the
 *      message);
 *   3. compute the fee from the SERVER's rate, never the app's;
 *   4. create the Withdrawal (PENDING) and the office alert.
 * Without the lock, two requests sent together would each see the whole
 * balance and both succeed; web requestWithdrawal has that race today.
 * The confirmation emails to the cleaner and the office are effects, flushed
 * after the commit and never on a replay. A replayed key returns the stored
 * response; the same key with a different body answers 422.
 */
export const WithdrawalRequest = z.object({
  /** What to take from the available balance, before the fee. */
  amountCents: z.number().int().positive(),
  /** Anything the office should know. */
  note: z.string().trim().max(500).optional(),
  clientEventId: z.uuid(),
});
export type WithdrawalRequest = z.infer<typeof WithdrawalRequest>;

export const WithdrawalResponse = z.object({
  withdrawal: Withdrawal,
  /** The balance left after this request, computed in the same transaction. */
  availableCents: Cents,
});
export type WithdrawalResponse = z.infer<typeof WithdrawalResponse>;

/** A job's line in a pay period: what it paid this cleaner. */
export const PayPeriodJob = z.object({
  jobId: z.string(),
  /** When the work happened (the job's effective date). */
  date: Instant,
  /** Neighbourhood or city, for recognising the job. */
  area: z.string().nullable(),
  service: z.string(),
  hours: z.number(),
  /** This cleaner's total for the job: work, tips and parking. */
  totalCents: Cents,
});
export type PayPeriodJob = z.infer<typeof PayPeriodJob>;

/**
 * GET /api/v1/pay/periods/:id — one pay period and the jobs in it. `:id` is
 * a payout id from this cleaner's list, or "current" for the live week.
 *
 * Access as GET /pay. The payout must belong to the caller (else 404). Jobs
 * are the caller's COMPLETED or PAID jobs whose effective date falls in the
 * period, each at computeJobPayShares' figure for the caller (the number
 * payroll pays), so the lines add up to `baseCents`.
 */
export const PayPeriodDetailResponse = z.object({
  period: PayPeriodSummary,
  jobs: z.array(PayPeriodJob),
});
export type PayPeriodDetailResponse = z.infer<typeof PayPeriodDetailResponse>;

/**
 * GET /api/v1/pay/jobs/:jobId — what one job paid this cleaner, and why.
 * getPayBreakdown's CLEANER payload, in cents.
 *
 * Access as GET /pay, and the caller must be the job's lead or on its crew
 * (else 404) — even an admin calling v1 as staff gets only their own share.
 * Nothing internal: no price, charges, tier, percentage or pool.
 */
export const JobPayResponse = z.object({
  jobId: z.string(),
  date: Instant,
  area: z.string().nullable(),
  service: z.string(),
  basis: openEnum(PAY_BASES),
  /** The rule in words, ready to print: "Hourly — 3.5h clocked × $25.00/h". */
  basisLabel: z.string(),
  /** HOURLY jobs only. */
  hourlyRateCents: Cents.nullable(),
  /** The work part of the total. */
  workCents: Cents,
  /** This cleaner's even share of the tips. */
  tipCents: Cents,
  /** This cleaner's even share of parking / transportation. */
  parkingCents: Cents,
  /** What this cleaner is paid for the job: work + tip + parking. */
  totalCents: Cents,
  ratingBoost: z.object({
    state: openEnum(RATING_BOOST_STATES),
    /** APPLIED: the multiplier on the cleaner's rate, e.g. 1.05. */
    multiplier: z.number().nullable(),
    /** LOCKED: ratings so far, and how many unlock the boost. */
    ratingsSoFar: z.number().int().nullable(),
    ratingsRequired: z.number().int().nullable(),
    /** NOT_APPLICABLE: why not. */
    reason: openEnum(RATING_BOOST_REASONS).nullable(),
  }),
});
export type JobPayResponse = z.infer<typeof JobPayResponse>;
