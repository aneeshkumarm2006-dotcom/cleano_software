// "On hold" — the status that had no name, no reason and no way out.
// Round 4, fix 6 (`_ai_context/awerfixesaug18.pdf` p5).
//
// ## What was actually wrong
//
// The client asked "what currently triggers On Hold, and is it automatic or
// manual?". The honest answer from recon was: it is automatic only, and it was
// never a real status. "On hold" is the CALENDAR's display label for
// `JobStatus.CREATED` — the Prisma default — and three unrelated things landed
// there:
//
//   1. every admin-created job, because `saveJob` never set a status at all;
//   2. a BookingKoala row imported with $0 service total and $0 final amount;
//   3. a post-construction quote (or a flexible booking) that is genuinely not
//      scheduled work yet.
//
// (1) is not a hold, it is a default leaking into the UI, and it made the other
// two invisible in the noise. There was no hold reason, no manual hold action
// and no release action, and four screens rendered the same enum four different
// ways — "On hold" (calendar), "Unconfirmed" (my-team), "Created" (clients,
// cleaner calendar).
//
// ## What this module is
//
// The single vocabulary for holds. `saveJob` now stamps SCHEDULED explicitly
// (see its create path), so from this round on `CREATED` MEANS on hold — and a
// job that is on hold carries `Job.holdReason` saying why. This file is where
// that meaning lives: the status constant, the label, the reason strings the
// automatic producers write, and the predicate every counting helper asks.
//
// PURE — no DB, no framework, no `@prisma/client` import, exactly like
// `quote-status.ts`. Client components render off these labels (the jobs list
// pill, the calendar drawer, the job detail banner), so anything server-only
// here would break the build at the far end of the app.

/**
 * The enum value that means "on hold".
 *
 * Spelled once, here, rather than as a bare `"CREATED"` in a dozen predicates:
 * the whole point of this round is that the two words stopped meaning different
 * things depending on which file you were reading.
 */
export const ON_HOLD_STATUS = "CREATED" as const;

/** The one label. Every admin surface says this and nothing else. */
export const HOLD_LABEL = "On hold";

/**
 * What a hold says when nothing wrote a reason — i.e. every row that predates
 * `Job.holdReason`. Deliberately not "Unknown": an admin can act on "pending
 * review" (open it, price it, release it), which is what the PDF asks for.
 */
export const DEFAULT_HOLD_REASON = "Pending admin review";

/**
 * The reasons the AUTOMATIC producers write, so "automatic holds show their
 * trigger" (PDF p5) is one string per trigger rather than prose retyped at each
 * call site. The backfill in `scripts/releaseLegacyJobHolds.ts` classifies old
 * rows into these same four, and `verify-awer-fixes-4.ts` pins each producer to
 * the constant it is supposed to write.
 */
export const HOLD_REASON = {
  /** BookingKoala row with $0 service total AND $0 final amount. */
  IMPORT_ZERO_TOTAL: "Imported with $0 total — review pricing",
  /** Post-construction booking waiting on an admin price / customer answer. */
  QUOTE_PENDING: "Quote pending review — price and send it to the customer",
  /** Customer turned the quote down; the booking is not work any more. */
  QUOTE_DECLINED: "Quote declined — cancel this booking or send a new price",
  /** Customer booked "any day" — there is no date to schedule against yet. */
  FLEXIBLE_DATE: "Flexible booking — confirm a date with the customer",
  /** Admin created the job without a date, so it cannot be scheduled. */
  NO_DATE: "Created without a date — set one to schedule this job",
} as const;

export type HoldReason = (typeof HOLD_REASON)[keyof typeof HOLD_REASON];

/** The statuses that are NOT live, working jobs: cancelled, and on hold. */
export const INACTIVE_JOB_STATUSES = ["CANCELLED", ON_HOLD_STATUS] as const;

/** The columns a hold predicate reads. Prisma rows and DTOs both satisfy it. */
export interface JobHoldShape {
  status: string;
  holdReason?: string | null;
}

/** Is this job on hold? */
export function isOnHold(j: JobHoldShape): boolean {
  return j.status === ON_HOLD_STATUS;
}

/**
 * The reason to SHOW for a held job — never blank, never null.
 *
 * A hold with no visible reason is the bug this round is fixing, so the fallback
 * is a real sentence rather than an empty string that would render as a dangling
 * dash.
 */
export function holdReasonText(reason?: string | null): string {
  const t = (reason ?? "").trim();
  return t.length > 0 ? t : DEFAULT_HOLD_REASON;
}

/**
 * The label the PDF asks for: "On hold — {reason}".
 *
 * Used for tooltips and inline text. The PILL itself stays the bare
 * `HOLD_LABEL` (a pill is a chip, not a paragraph) and carries this as its
 * `title`, which is the "on hover" half of the acceptance criterion.
 */
export function holdLabel(reason?: string | null): string {
  return `${HOLD_LABEL} — ${holdReasonText(reason)}`;
}
