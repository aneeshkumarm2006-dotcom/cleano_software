// Available jobs: open work a cleaner can claim, a preview of each, and the
// claim itself. The web equivalents are the available-jobs page,
// getAvailableJobPreview and claimJob (apps/web/src/app/cleaners/available-jobs).
//
// WHAT A CLEANER MAY SEE BEFORE CLAIMING. A cleaner who has not claimed a job
// is not on it yet, so the server withholds everything that is a way in or a
// person rather than work:
//   - the street address, unit and postal code: only the neighbourhood or city
//     (`area`) is sent until the job is theirs. The full address arrives with
//     the job in GET /api/v1/jobs/:id once the claim succeeds;
//   - the client's name, phone and email;
//   - access notes, door and gate codes;
//   - the client's price, and any other cleaner's pay. The only money in this
//     file is THIS cleaner's own estimate, from the same payout math payroll
//     uses (computeJobPayout / the tier rate), never `price / crew`.
// Adding any of those to a response here is a privacy regression.
import { z } from "zod";

import { Cents, Instant, openEnum, page } from "./common";
import { JobSummary } from "./jobs";

/** How this cleaner would be paid for the job. A copy of Job.payType's values. */
export const AVAILABLE_PAY_TYPES = ["PERCENTAGE", "HOURLY", "FLAT"] as const;

/** GET /api/v1/jobs/available?when= — a closed request enum. */
export const AVAILABLE_WHEN = ["all", "week", "weekend"] as const;
export type AvailableWhen = (typeof AVAILABLE_WHEN)[number];

/**
 * Why a claim was refused: the `error.code` of a refused claim. The app turns
 * each into plain words and falls back to the server's `message` for a code
 * this build doesn't know. Error codes are strings in the envelope, so a code
 * added later reaches an old build as its message, never as a crash.
 */
export const CLAIM_REFUSALS = [
  /** The job is already this cleaner's (as lead or crew). Treated as success. */
  "ALREADY_CLAIMED",
  /** Outside the cleaner's approved service categories. */
  "CATEGORY_NOT_ALLOWED",
  /** A trainee, and nobody approved is on the crew yet. */
  "TRAINEE_NEEDS_CREW",
  /** On hold with a reason the office gave. */
  "ON_HOLD",
  /** The start time has passed. */
  "ALREADY_STARTED",
  /** Every spot is taken. */
  "FULLY_STAFFED",
  /** No longer open work: cancelled, in progress, an unsettled quote, deleted. */
  "NOT_AVAILABLE",
] as const;
export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];

/** What this cleaner would earn, as far as it can honestly be known. */
export const AvailablePay = z.object({
  type: openEnum(AVAILABLE_PAY_TYPES),
  /**
   * PERCENTAGE jobs: this cleaner's own estimated payout (their tier and
   * rating rate on the job's pay basis). Null on FLAT jobs, where dispatch
   * sets the amount per assignment: the app says so rather than guessing.
   */
  estimateCents: Cents.nullable(),
  /** HOURLY jobs: the rate per hour. Null otherwise. */
  hourlyRateCents: Cents.nullable(),
});
export type AvailablePay = z.infer<typeof AvailablePay>;

/** A job on the board, as the list shows it. */
export const AvailableJobSummary = z.object({
  id: z.string(),
  startsAt: Instant,
  /** Null when the office hasn't set an end: the length is "set by dispatch". */
  endsAt: Instant.nullable(),
  /** The client is flexible on the start time. */
  isFlexible: z.boolean(),
  /**
   * Neighbourhood or city ONLY ("Le Plateau", "Westmount"). Never the street,
   * unit or postal code: those are sent once the job is claimed.
   */
  area: z.string().nullable(),
  service: z.object({
    /** Canonical category key ("DEEP", "MOVE_IN_OUT", …); open-ended on purpose. */
    category: z.string(),
    /** The company's own name for the service: "Deep clean". */
    label: z.string(),
  }),
  property: z.object({
    /** "Condo", "House": the company's label, or null when not recorded. */
    type: z.string().nullable(),
    beds: z.number().int().nullable(),
    baths: z.number().int().nullable(),
  }),
  pay: AvailablePay,
  crew: z.object({
    /** How many cleaners the job needs. */
    required: z.number().int(),
    /** How many have it already. `required - claimed` spots are left. */
    claimed: z.number().int(),
  }),
});
export type AvailableJobSummary = z.infer<typeof AvailableJobSummary>;

/**
 * GET /api/v1/jobs/available?when=all|week|weekend&cursor=…
 *
 * Access: `staff` (the v1 allow-list: EMPLOYEE and FIELD_LEAD), active,
 * password settled. Never CLIENT or APPLICANT: today the web only excludes
 * CLIENT, which lets an applicant read the board (API_V1.md §10).
 *
 * The server must return exactly what claimJob would accept, by building the
 * query from the SAME rule, never a copy of it:
 *   - `claimableJobsWhere(caller, now)`: not deleted, starts at or after now,
 *     open for claim (SCHEDULED, or CREATED without a hold reason), quote
 *     settled, and not a job the caller already leads or is already on;
 *   - then fewer cleaners than `requiredCleaners`;
 *   - then `isCategoryAllowed(jobType, caller.allowedServiceCategories)`.
 * Both JS-side filters run BEFORE pagination, so a restricted cleaner never
 * gets a short or empty page while claimable work exists further on.
 * Ordered by start time, soonest first. `when` narrows by the start's date in
 * the COMPANY's zone: `week` is today through six days on, `weekend` is
 * Saturday and Sunday. Omitted means `all`.
 */
export const AvailableJobsResponse = page(AvailableJobSummary);
export type AvailableJobsResponse = z.infer<typeof AvailableJobsResponse>;

/**
 * GET /api/v1/jobs/available/:id — everything a cleaner needs to decide, and
 * nothing more (the web's getAvailableJobPreview, minus the street address and
 * the client's name).
 *
 * Access as the list. READ-ONLY: previewing never locks, holds, assigns or
 * hides the job, and never creates a checklist. The job must pass the same
 * three filters as the list; anything else, including a job the caller is
 * already on, answers 404 NOT_FOUND ("This job isn't available any more"), so
 * a job that can't be claimed can't be previewed and ids can't be probed.
 */
export const AvailableJobDetailResponse = AvailableJobSummary.extend({
  /** endsAt − startsAt, in minutes. Null when there's no end: "set by dispatch". */
  plannedMinutes: z.number().int().nullable(),
  property: z.object({
    type: z.string().nullable(),
    beds: z.number().int().nullable(),
    baths: z.number().int().nullable(),
    halfBaths: z.number().int().nullable(),
    squareFeet: z.number().int().nullable(),
  }),
  addOns: z.array(z.object({ name: z.string(), quantity: z.number().int() })),
  /**
   * The checklist templates the job WOULD get, resolved with the same rule the
   * claim uses (resolveChecklistTemplates). Names and counts only.
   */
  checklists: z.array(
    z.object({ name: z.string(), itemCount: z.number().int(), requiredCount: z.number().int() }),
  ),
  /** Instructions for cleaners, through sanitizeCleanerNotes: billing stripped. */
  notes: z.string().nullable(),
});
export type AvailableJobDetailResponse = z.infer<typeof AvailableJobDetailResponse>;

/**
 * POST /api/v1/jobs/available/:id/claim
 * Idempotency-Key: the body's `clientEventId`.
 *
 * Access as the list. The server re-checks EVERYTHING claimJob checks, from
 * the database, at the moment of the write, never trusting that the job was
 * on the caller's board:
 *   - the job exists and isn't deleted (else 404 NOT_FOUND);
 *   - the caller isn't already its lead or on its crew (409 ALREADY_CLAIMED);
 *   - the caller's service categories allow it (409 CATEGORY_NOT_ALLOWED);
 *   - a TRAINEE needs an approved (non-trainee) cleaner already on the crew
 *     (409 TRAINEE_NEEDS_CREW);
 *   - status is open for claim: SCHEDULED, or CREATED with no hold reason
 *     (409 ON_HOLD when a reason is recorded, else 409 NOT_AVAILABLE);
 *   - the quote, if any, is settled (409 NOT_AVAILABLE);
 *   - it hasn't started, by the server's clock (409 ALREADY_STARTED);
 *   - a spot is left (409 FULLY_STAFFED).
 * The write is claimJob's compare-and-set: the same guards in the UPDATE's
 * WHERE, the capacity re-checked after it and released if over, then the lead
 * (only if none), the JobAssignment row and the job log, all in ONE
 * transaction. The office's "grabbed" notice is an effect, flushed after the
 * commit and never on a replay. Every refusal has `retryable: false`.
 *
 * A replayed key returns the stored response. The same key with a different
 * job answers 422.
 */
export const ClaimJobRequest = z.object({ clientEventId: z.uuid() });
export type ClaimJobRequest = z.infer<typeof ClaimJobRequest>;

export const ClaimJobResponse = z.object({
  /** The job, now the caller's, as My jobs shows it: full address included. */
  job: JobSummary,
});
export type ClaimJobResponse = z.infer<typeof ClaimJobResponse>;
