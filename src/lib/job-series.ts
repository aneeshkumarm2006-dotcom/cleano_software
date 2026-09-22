// Recurring-series helpers (awer_fixes.pdf item 9).
//
// A recurring booking is a PARENT job plus N child jobs linked by
// `Job.parentJobId`. Each child is a real, independently editable Job row —
// that is what already satisfies "move or edit one instance without changing
// the full series". What was missing is the other half: applying an edit to the
// WHOLE series at once.

import { db } from "@/lib/org-db";
import { allocateJobNumber } from "@/lib/job-number";

/**
 * Fields that propagate when an admin chooses "apply to the whole series".
 *
 * Deliberately EXCLUDES:
 *   • startTime / jobDate / endTime — each occurrence has its own slot; that's
 *     the entire point of a recurring series;
 *   • status, paymentReceived, paidAt, invoiceSent, clock times, tips —
 *     per-occurrence facts, not series settings;
 *   • discountAmount — a child's discount carries its own recurring-frequency
 *     component, so copying the edited job's figure across would either wipe or
 *     duplicate that. Left alone on purpose;
 *   • payRateMultiplier — deprecated (AWER round 3, fix 1). The rating premium
 *     is a property of the CLEANER, not the job, so there is nothing to
 *     propagate across a series;
 *   • billedActualHours — measured from each occurrence's own clock (Stage 8).
 *     Propagating it would bill next month's visit for hours worked this month.
 */
export const SERIES_PROPAGATED_FIELDS = [
  "clientName",
  "clientId",
  "location",
  "aptNumber",
  // The postal code half of the same address snapshot (new photo/address
  // fixes, item 2). `location`, `aptNumber` and `clientAddressId` all propagate
  // already, so leaving this behind was the one way a recurring series could
  // end up with occurrence 4 carrying a different postal code from occurrence 1
  // at the identical address — which then reached the invoice, since the PDF
  // prints whichever the job it is billing happens to hold.
  "postalCode",
  // Which saved address the series is served at (item 2). Safe in updateMany:
  // it is a scalar FK column, not a relation, and every occurrence of a series
  // is at the same address by definition — the snapshot fields above already
  // propagate, so leaving this behind would make siblings disagree with their
  // own location string about where they are.
  "clientAddressId",
  "description",
  "jobType",
  "price",
  "employeePay",
  "payType",
  "hourlyRate",
  // How the CUSTOMER is billed (Stage 8). A series is one agreement, so
  // occurrence 4 must not be billed by a different rule than occurrence 1 —
  // the same reasoning that already propagates `price` and `pricingMode`'s
  // effect. `billedActualHours` is deliberately EXCLUDED below: it is measured
  // per occurrence from that occurrence's own clock, so copying one visit's
  // worked hours across the series would bill every future visit for work that
  // has not happened.
  "billingType",
  "billedHourlyRate",
  "billedEstimatedHours",
  "notes",
  "paymentType",
  "bedCount",
  "bathCount",
  "halfBathCount",
  "squareFootage",
  // What kind of building the series is served at (Stage 9). It describes the
  // ADDRESS, and `location`/`clientAddressId` already propagate above — so
  // leaving this behind would let occurrence 4 disagree with its own address
  // about whether it is a house. Same reasoning as the room counts.
  "propertyType",
  // Which checklist the series uses (Stage 10 / PDF #10). The PDF asks for it
  // in as many words — "checklist assignment should stay consistent when
  // recurring jobs are generated" — and a series is one agreement, so
  // occurrence 4 must not be worked to a different list than occurrence 1.
  //
  // Note this only propagates the PIN. A client- or address-scoped template
  // needs nothing here: every occurrence shares the same clientId and
  // clientAddressId (both propagate above), so the resolver picks the same
  // customer checklist for each of them on its own.
  "checklistTemplateId",
  "taxExempt",
  "isFlexible",
  "requiredCleaners",
  // Whether this series gets the frequency discount, and at what rate (Sept 10
  // list, item 8). A series is ONE agreement: occurrence 4 must not be
  // discounted on different terms from occurrence 1, which is the same reason
  // `price` and `billingType` already propagate.
  "recurringDiscountMode",
  "recurringDiscountPercentOverride",
  // The cadence the series runs on (Sept 17, item 21). A series is ONE
  // agreement, so occurrence 4 cannot be on a different cadence from
  // occurrence 1 — and without this, changing the frequency on one job would
  // leave every sibling still claiming the old one.
  "recurringFrequency",
] as const;

export type SeriesField = (typeof SERIES_PROPAGATED_FIELDS)[number];

/**
 * The id every member of this job's series hangs off: the parent when the job
 * is a child, otherwise the job itself.
 */
export function seriesRootId(job: {
  id: string;
  parentJobId: string | null;
}): string {
  return job.parentJobId ?? job.id;
}

/**
 * Statuses that must never be rewritten by a series edit. Changing the price of
 * a job that is already completed and paid would corrupt financial history and
 * silently disagree with an invoice that has already gone out.
 */
const IMMUTABLE_STATUSES = ["COMPLETED", "PAID", "CANCELLED"] as const;

export interface SeriesUpdateResult {
  /** How many sibling jobs were updated (excludes the edited job itself). */
  updated: number;
  /** How many were skipped because they are completed/paid/cancelled. */
  skipped: number;
}

/**
 * Apply an edit across a recurring series.
 *
 * `data` should be the same field set saveJob built for the edited job; only
 * the keys in SERIES_PROPAGATED_FIELDS are copied, so callers can pass the
 * whole object without accidentally overwriting dates or payment state.
 *
 * Completed / paid / cancelled occurrences are left untouched and reported via
 * `skipped`, so the admin is told the series was not blanket-rewritten.
 */
export async function applyToJobSeries(
  editedJobId: string,
  rootId: string,
  data: Record<string, unknown>,
  cleanerIds?: string[],
  /**
   * Add-ons for the series (Sept 17, item 20: the change should apply "when
   * editing date/time, cleaner assignment, price, ADD-ONS, notes, checklist,
   * address details, frequency settings, or job scope").
   *
   * A relation, so it cannot ride along in `updateMany` — the same reason the
   * cleaner team is handled separately below. `undefined` means the save did
   * not carry the add-on editor and the siblings' own add-ons are left alone;
   * an EMPTY ARRAY means the admin cleared them, which must propagate.
   */
  addOns?: { name: string; price: number; quantity: number }[]
): Promise<SeriesUpdateResult> {
  const payload: Record<string, unknown> = {};
  for (const field of SERIES_PROPAGATED_FIELDS) {
    if (field in data) payload[field] = data[field];
  }

  const siblings = await db.job.findMany({
    where: {
      deletedAt: null,
      id: { not: editedJobId },
      OR: [{ id: rootId }, { parentJobId: rootId }],
    },
    select: { id: true, status: true },
  });

  const editable = siblings.filter(
    (j) => !(IMMUTABLE_STATUSES as readonly string[]).includes(j.status)
  );
  const skipped = siblings.length - editable.length;

  if (editable.length === 0) return { updated: 0, skipped };

  if (Object.keys(payload).length > 0) {
    await db.job.updateMany({
      where: { id: { in: editable.map((j) => j.id) } },
      data: payload,
    });
  }

  // The cleaner team is a relation, so it can't ride along in updateMany.
  if (cleanerIds) {
    const { resolveJobLead, syncJobAssignments } = await import(
      "@/lib/job-assignments"
    );
    for (const j of editable) {
      await db.job.update({
        where: { id: j.id },
        data: {
          employeeId: resolveJobLead(null, cleanerIds),
          cleaners:
            cleanerIds.length > 0
              ? { set: cleanerIds.map((id) => ({ id })) }
              : { set: [] },
        },
      });
      await syncJobAssignments(j.id, cleanerIds);
    }
  }

  // Add-ons, for the same reason and in the same way (Sept 17, item 20). The
  // price they contribute already propagates through `price` above, so a
  // series whose add-ons did NOT follow the edit showed occurrence 4 charging
  // for a carpet clean its line items never mentioned.
  if (addOns) {
    for (const j of editable) {
      await db.jobAddOn.deleteMany({ where: { jobId: j.id } });
      if (addOns.length > 0) {
        await db.jobAddOn.createMany({
          data: addOns.map((a) => ({
            jobId: j.id,
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
        });
      }
    }
  }

  return { updated: editable.length, skipped };
}

/** Series membership info for the job modal's "apply to" control. */
export async function getSeriesInfo(jobId: string): Promise<{
  isSeries: boolean;
  rootId: string;
  /** Occurrences that a series edit would actually change. */
  editableCount: number;
}> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, parentJobId: true },
  });
  if (!job) return { isSeries: false, rootId: jobId, editableCount: 0 };

  const rootId = seriesRootId(job);
  const members = await db.job.findMany({
    where: {
      deletedAt: null,
      id: { not: jobId },
      OR: [{ id: rootId }, { parentJobId: rootId }],
    },
    select: { status: true },
  });

  const editableCount = members.filter(
    (m) => !(IMMUTABLE_STATUSES as readonly string[]).includes(m.status)
  ).length;

  return { isSeries: members.length > 0, rootId, editableCount };
}

/** What a recurring cancellation should reach. */
export type SeriesCancelScope =
  /** Only the occurrence in front of the admin. */
  | "this"
  /** Every future occurrence — the series ends here. */
  | "future"
  /** Future occurrences up to a date; the schedule resumes after it. */
  | "pause";

export interface SeriesCancelPlan {
  /** How many occurrences this scope would cancel, not counting this one. */
  siblings: number;
  /** Occurrences left untouched because they are completed, paid or already cancelled. */
  protectedCount: number;
  /** The first date the schedule runs again. Only meaningful for "pause". */
  resumesOn: Date | null;
  /**
   * The span a confirm would actually clear, INCLUDING the occurrence the
   * admin is looking at — because that occurrence is part of what they are
   * confirming.
   *
   * A bare count is still ambiguous: "12 bookings" is a fortnight of daily
   * cleans or a year of monthly ones, and those are very different decisions.
   * The two dates are what make the number concrete. Both are null when the
   * job could not be read.
   */
  rangeStart: Date | null;
  rangeEnd: Date | null;
  /**
   * The last booking the schedule still has on the books, NOT counting the
   * occurrence in front of the admin (that one is cancelled either way).
   * Only computed for "pause": it is the date that says which resume dates
   * can still be paused TO. Null when this occurrence is the last one left.
   */
  lastOccurrence: Date | null;
  /**
   * True when the pause would leave nothing to come back to — every booking
   * the series has left falls inside the pause window.
   *
   * A series here is a FIXED set of jobs, written once at creation (saveJob
   * → recurrenceCount). Nothing tops it up afterwards: no cron generates
   * occurrences, and the cadence is not even stored on the Job rows, so
   * there is nothing to regenerate from. A pause reaching past the last
   * occurrence is therefore not a pause at all — the schedule ENDS, and
   * silently. That is the one outcome the admin has to be told about
   * BEFORE confirming, not left to discover when the customer calls in
   * the spring.
   */
  endsSeries: boolean;
}

/**
 * Which sibling occurrences a scope reaches.
 *
 * FORWARD only, always, and forward FROM THE OCCURRENCE ON SCREEN. Two separate
 * invariants, both of which this query has to hold:
 *
 *   1. "This and all future" is read off the booking the admin actually opened.
 *      From occurrence 2 of four it means 2, 3 and 4 — occurrence 1 is earlier,
 *      still upcoming, and still wanted. Anchoring on the clock instead made
 *      every remaining occurrence "future", so the cancellation reached
 *      BACKWARDS and took occurrence 1 with it.
 *   2. A recurring cancellation must never touch work that has already
 *      happened: those jobs are payroll, invoices and customer history, and
 *      "cancel the rest of the schedule" has never meant "and erase the
 *      spring". So opening a PAST occurrence still cannot reach back over the
 *      visits between it and now.
 */
async function futureSiblings(
  jobId: string,
  scope: SeriesCancelScope,
  pauseUntil: Date | null,
) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, parentJobId: true, startTime: true },
  });
  // The start time of the occurrence in front of the admin. Distinct from the
  // `anchor` window floor computed below: this one is what the cancel panel
  // states as the near edge of the range, because that booking is cancelled
  // too — even when it is in the past and the floor has moved up to now.
  const anchorStart = job?.startTime ?? null;
  if (!job || scope === "this")
    return { rootId: job ? seriesRootId(job) : jobId, rows: [], anchorStart };

  const rootId = seriesRootId(job);
  // Whichever of the two is LATER: the opened occurrence carries invariant 1,
  // the clock carries invariant 2. For the normal case — an admin ending the
  // schedule from an upcoming visit — the occurrence wins and earlier siblings
  // are left scheduled.
  //
  // Both sides are absolute instants (`startTime` is a timestamp column stored
  // in UTC, and the calendar drawer converts to the business timezone only for
  // DISPLAY), so this comparison is instant-to-instant and needs no timezone
  // conversion. Converting either side into the business timezone here would
  // shift the boundary by the offset and start eating the neighbouring visit.
  const now = new Date();
  const anchor = job.startTime > now ? job.startTime : now;
  const rows = await db.job.findMany({
    where: {
      deletedAt: null,
      id: { not: jobId },
      OR: [{ id: rootId }, { parentJobId: rootId }],
      startTime: {
        // Inclusive on purpose. A sibling standing at the IDENTICAL timestamp
        // (same slot, second unit at the same address) is part of "this and all
        // future" — it is not earlier than the booking on screen. The opened
        // occurrence itself can't be swept up by that: `id: { not: jobId }`
        // above has already excluded it.
        gte: anchor,
        // A pause has a far edge; ending the series does not.
        ...(scope === "pause" && pauseUntil ? { lte: pauseUntil } : {}),
      },
    },
    select: { id: true, status: true, startTime: true },
    orderBy: { startTime: "asc" },
  });
  return { rootId, rows, anchorStart };
}

/**
 * What "cancel all future" or "pause until" would actually do, before doing it.
 *
 * Exists so the confirmation can say a number. "Cancel all future bookings" on
 * a weekly clean is somewhere between one job and forty, and an admin should
 * never find out which after pressing the button.
 */
export async function planSeriesCancellation(
  jobId: string,
  scope: SeriesCancelScope,
  pauseUntil: Date | null = null,
): Promise<SeriesCancelPlan> {
  const { rootId, rows, anchorStart } = await futureSiblings(jobId, scope, pauseUntil);
  const cancellable = rows.filter(
    (r) => !(IMMUTABLE_STATUSES as readonly string[]).includes(r.status),
  );

  // For a pause, the useful thing to show is when the customer next sees us.
  let resumesOn: Date | null = null;
  let lastOccurrence: Date | null = null;
  if (scope === "pause" && pauseUntil) {
    const next = await db.job.findFirst({
      where: {
        deletedAt: null,
        startTime: { gt: pauseUntil },
        status: { notIn: ["CANCELLED"] },
        OR: [{ id: rootId }, { parentJobId: rootId }],
      },
      select: { startTime: true },
      orderBy: { startTime: "asc" },
    });
    resumesOn = next?.startTime ?? null;

    // …and when nothing comes back, the useful fact is where the schedule
    // stops. Same filter as the query above, read from the other end, so
    // "resumes on" and "ends on" can never disagree with each other: if
    // this date exists and the resume date is on or past it, the pause is
    // an ending. The viewed occurrence is excluded because this action
    // cancels it either way — it can never be what the series resumes to.
    const last = await db.job.findFirst({
      where: {
        deletedAt: null,
        id: { not: jobId },
        startTime: { gt: new Date() },
        status: { notIn: ["CANCELLED"] },
        OR: [{ id: rootId }, { parentJobId: rootId }],
      },
      select: { startTime: true },
      orderBy: { startTime: "desc" },
    });
    lastOccurrence = last?.startTime ?? null;
  }

  // `rows` come back ordered by startTime, so the last survivor of the filter
  // is the far edge. With no siblings left the range collapses onto the single
  // occurrence being cancelled, which is exactly what the panel should say.
  const lastCancellable = cancellable.length
    ? cancellable[cancellable.length - 1].startTime
    : null;

  return {
    siblings: cancellable.length,
    protectedCount: rows.length - cancellable.length,
    resumesOn,
    rangeStart: anchorStart,
    rangeEnd: lastCancellable ?? anchorStart,
    lastOccurrence,
    endsSeries: scope === "pause" && !!pauseUntil && resumesOn === null,
  };
}

/**
 * Cancel the future of a recurring series.
 *
 * Returns how many occurrences were cancelled, NOT counting the one the admin
 * was looking at — that one is cancelled by the normal single-job path, which
 * owns the customer email, the refund rules and the fee policy. This function
 * is deliberately only the extra reach.
 */
export async function cancelJobSeries(
  jobId: string,
  scope: SeriesCancelScope,
  opts: { pauseUntil?: Date | null; reason?: string | null } = {},
): Promise<{ cancelled: number; protectedCount: number }> {
  const pauseUntil = opts.pauseUntil ?? null;
  const { rows } = await futureSiblings(jobId, scope, pauseUntil);
  const ids = rows
    .filter((r) => !(IMMUTABLE_STATUSES as readonly string[]).includes(r.status))
    .map((r) => r.id);
  if (ids.length === 0) return { cancelled: 0, protectedCount: rows.length };

  await db.job.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "CANCELLED",
      cancellationReason:
        opts.reason?.trim() ||
        (scope === "pause"
          ? "Recurring schedule paused"
          : "Recurring schedule ended"),
    },
  });

  return { cancelled: ids.length, protectedCount: rows.length - ids.length };
}

// ── Changing the cadence of a live series (Sept 17 list, item 21) ──────────

/** Cadences the job form offers. ONE_TIME ends the series. */
export type SeriesFrequency =
  | "ONE_TIME"
  | "DAILY"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "TWICE_WEEKLY"
  | "HIGH_FREQUENCY";

export interface FrequencyChangeImpact {
  /** Upcoming occurrences that would be withdrawn. */
  removable: number;
  /** Occurrences left alone because they are started, settled or past. */
  kept: number;
}

/**
 * Occurrences a cadence change may touch.
 *
 * Deliberately narrow. A job is only movable when it has NOT started, is not
 * settled, and is in the future — so a shift somebody has clocked into, a
 * visit that has been paid, and anything that already happened all stay
 * exactly where they are. That is the PDF's "past completed jobs should stay
 * unchanged", read strictly: the risk here is withdrawing a booking a customer
 * has already been told about, so the bar for touching one is high.
 */
export async function movableFutureOccurrences(
  rootId: string,
  excludeJobId: string,
  now: Date = new Date(),
): Promise<{ id: string; startTime: Date }[]> {
  const rows = await db.job.findMany({
    where: {
      deletedAt: null,
      id: { not: excludeJobId },
      OR: [{ id: rootId }, { parentJobId: rootId }],
      startTime: { gt: now },
      status: { notIn: [...IMMUTABLE_STATUSES] },
      clockInTime: null,
      workSessions: { none: {} },
    },
    select: { id: true, startTime: true },
    orderBy: { startTime: "asc" },
  });
  return rows;
}

/** What a cadence change would do, without doing it. For the confirmation. */
export async function previewFrequencyChange(
  editedJobId: string,
  rootId: string,
  now: Date = new Date(),
): Promise<FrequencyChangeImpact> {
  const [movable, total] = await Promise.all([
    movableFutureOccurrences(rootId, editedJobId, now),
    db.job.count({
      where: {
        deletedAt: null,
        id: { not: editedJobId },
        OR: [{ id: rootId }, { parentJobId: rootId }],
      },
    }),
  ]);
  return { removable: movable.length, kept: total - movable.length };
}

export interface FrequencyChangeResult {
  withdrawn: number;
  created: number;
  kept: number;
}

/**
 * Put a series onto a new cadence.
 *
 * WITHDRAWN, NOT DELETED. The occurrences this replaces are soft-deleted
 * (`deletedAt`), the same state the Jobs list's Archived view already shows.
 * Hard-deleting them would destroy assignment rows, invites, chat and logs for
 * bookings that were real — and a cadence change is an edit, not a purge. If
 * the admin got it wrong, the old occurrences are still there to look at.
 *
 * Only `movableFutureOccurrences` are touched, so nothing started, settled or
 * past is affected.
 *
 * The new occurrences are generated FROM the edited job, which stays put: it
 * is the visit the admin had open and is usually the next one due. Everything
 * after it is rebuilt on the new rhythm.
 */
export async function applyFrequencyChange(
  editedJobId: string,
  rootId: string,
  frequency: SeriesFrequency,
  opts: {
    /** How many occurrences to generate ahead, from the same setting creation uses. */
    horizon: number;
    /** Fields the new occurrences inherit from the edited job. */
    template: Record<string, unknown>;
    cleanerIds?: string[];
    addOns?: { name: string; price: number; quantity: number }[];
    now?: Date;
  },
): Promise<FrequencyChangeResult> {
  const now = opts.now ?? new Date();
  const movable = await movableFutureOccurrences(rootId, editedJobId, now);

  if (movable.length > 0) {
    await db.job.updateMany({
      where: { id: { in: movable.map((j) => j.id) } },
      data: { deletedAt: now },
    });
  }

  if (frequency === "ONE_TIME") {
    // The series ends here. The edited job stands alone, which is exactly what
    // "change it to one-time" means, and nothing new is generated.
    return { withdrawn: movable.length, created: 0, kept: 0 };
  }

  const { nextOccurrence, recurrenceCount } = await import("@/lib/booking-pricing");
  const count = recurrenceCount(frequency, opts.horizon);
  const edited = await db.job.findUnique({
    where: { id: editedJobId },
    select: { id: true, startTime: true, endTime: true, parentJobId: true },
  });
  if (!edited?.startTime) return { withdrawn: movable.length, created: 0, kept: 0 };

  // The duration of the edited visit, carried onto each new one. Reading it
  // off the job rather than assuming a fixed length keeps a four-hour deep
  // clean four hours long at every occurrence.
  const durationMs =
    edited.endTime && edited.startTime
      ? edited.endTime.getTime() - edited.startTime.getTime()
      : null;

  let cursor = edited.startTime;
  let created = 0;
  for (let i = 0; i < count; i++) {
    cursor = nextOccurrence(cursor, frequency as Exclude<SeriesFrequency, "ONE_TIME">);
    const start = new Date(cursor);
    // `any` for the same reason saveJob's own child block uses it: the payload
    // is assembled from a template object the type system cannot narrow, and
    // `jobNumber` is allocated one row at a time just below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childData: any = {
      ...opts.template,
        parentJobId: rootId,
        startTime: start,
        endTime: durationMs != null ? new Date(start.getTime() + durationMs) : null,
        jobDate: start,
        status: "SCHEDULED",
        recurringFrequency: frequency,
        // Per-occurrence facts never carry over from the visit being copied.
        clockInTime: null,
        clockOutTime: null,
        paymentReceived: false,
        paidAt: null,
        ...(opts.addOns && opts.addOns.length > 0
          ? {
              addOns: {
                create: opts.addOns.map((a) => ({
                  name: a.name,
                  price: a.price,
                  quantity: a.quantity,
                })),
              },
            }
          : {}),
        ...(opts.cleanerIds && opts.cleanerIds.length > 0
          ? { cleaners: { connect: opts.cleanerIds.map((id) => ({ id })) } }
          : {}),
    };
    childData.jobNumber = await allocateJobNumber();
    const child = await db.job.create({ data: childData, select: { id: true } });
    created++;
    if (opts.cleanerIds && opts.cleanerIds.length > 0) {
      const { syncJobAssignments } = await import("@/lib/job-assignments");
      await syncJobAssignments(child.id, opts.cleanerIds);
    }
  }

  return { withdrawn: movable.length, created, kept: 0 };
}
