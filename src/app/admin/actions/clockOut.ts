"use server";

import { db } from "@/lib/org-db";
import type { ScopedTx } from "@/lib/db-scoped";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { projectWashables } from "@/lib/wash";
import { notifyAdmins } from "@/lib/admin-alerts";
import { sendAdminClockedOut } from "@/lib/email";
import { ensureRatingRequest } from "@/lib/rating";
import { isCleanerLow } from "@/lib/inventory-thresholds";
import { loadCleanerThresholdDefault } from "@/lib/inventory-thresholds.server";
import {
  conditionFlagType,
  countableStatusFlagType,
  levelFlagType,
  statusLabel,
  type InventoryFlagType,
} from "@/lib/inventory-status";
import { snapshotBilledActualHours } from "@/lib/hourly-billing.server";
import { snapshotHourlyEmployeePay } from "@/lib/hourly-pay.server";
import {
  findOpenSession,
  findRecentlyClosedSession,
  syncClockMirrors,
} from "@/lib/work-sessions.server";
import {
  CLOCK_OUT_RESUME_WINDOW_MS,
  classifyClockOutError,
  clockOutErrorClass,
  describeReportForLog,
  validateClosingReport,
  type ClockOutErrorCode,
  type ClockOutFailure,
  type ClockOutKit,
  type ClosingReport,
  type ValidatedReportEntry,
} from "@/lib/clock-out";

/**
 * Cleaner clock-out — cleano_new_fixes.pdf fix 6 (`_ai_context/TODO.md` Stage 5)
 * and the closing inventory report (cleano_inventory_operations_fixes.pdf #2,
 * Stage 3).
 *
 * ## What was wrong (Stage 5 — failure handling)
 *
 * One catch-all mapped every failure — a bad number, a pooler blip, a product
 * that had left the cleaner's kit — to the string “Failed to clock out”, with no
 * record anywhere but `console.error`. An admin asked "why couldn't she clock
 * out?" had literally nothing to look at.
 *
 * Worse, it was not one act. The session close committed in a transaction, and
 * then `syncClockMirrors`, the status flip and the rating request ran outside
 * it. A failure in that tail told the cleaner it had failed while their session
 * was already closed — and the retry hit `findOpenSession` → null → "You're not
 * clocked in on this job". Stuck, on site, with the work half-saved.
 *
 *   NAMED       every failure carries a `code`, a sentence worth reading, and
 *               — when one product is to blame — the `field` that names it, so
 *               the modal can mark that input instead of shrugging.
 *   LOGGED      every failure writes a best-effort `CLOCK_OUT_FAILED` JobLog
 *               row (cleaner, time, error class, sanitized payload summary) that
 *               shows up on the admin job's Activity timeline, AND raises an
 *               admin alert (Stage 7.5) so nobody has to go looking.
 *   RESUMABLE   the writes are one transaction, so they either all landed or
 *               none did. If the tail fails, a retry inside
 *               CLOCK_OUT_RESUME_WINDOW_MS finds the session this cleaner just
 *               closed, re-runs ONLY the idempotent tail, and returns success.
 *               No inventory is touched twice — the closed session is itself the
 *               proof those writes committed.
 *
 * ## What was wrong (Stage 3 — the inventory half)
 *
 * Clock-out used to ASK A CLEANER TO ESTIMATE and then treat the estimate as
 * fact. "Light use" meant 15 trigger pulls, a pull meant 1.25 ml, and the
 * product of two invented numbers was deducted from that cleaner's kit, priced
 * at `costPerUnit`, and posted as a supplies expense against the job. Nobody
 * counts trigger pulls, so every one of those figures was fiction that looked
 * like measurement — and it accumulated, silently, into the stock levels the
 * refill alerts and the forecast were computed from.
 *
 * PDF #2 deletes the idea outright. Clock-out now asks the ONE question a
 * cleaner can answer accurately — "did anything change?" — and records what they
 * say, in the vocabulary that fits the item:
 *
 *   NOTHING IS DEDUCTED. Not a millilitre, not a unit. A LEVEL or CONDITION
 *   report moves no quantity at all; a COUNT report SETS the number to what the
 *   cleaner says is left, which is a recount rather than a subtraction.
 *   NO SUPPLIES TRANSACTION. Per-job supplies cost was priced off the estimate,
 *   so it went with it (TODO decision D2 — see docs/reference/INVENTORY_REPORTING_CHANGE.md).
 *   FLAGS, NOT SILENCE. Low / empty / missing / damaged / needs-maintenance
 *   raises an `InventoryFlag` an admin works through, de-duped per (cleaner,
 *   product, type) so a queue like the 48-row one in the PDF cannot re-form.
 *   HISTORY. Every reported line writes an `InventoryChange` carrying previous
 *   status → new status, the job, the cleaner and the note — exactly the list
 *   PDF #1 asks history to keep.
 *
 * Pure rules — payload validation, error classification, the log summary — live
 * in `src/lib/clock-out.ts` so they can be tested without a database. This file
 * is `"use server"`, so anything exported from it has to be a server action.
 */

export type ClockOutSuccess = {
  success: true;
  restockNeeded: boolean;
  jobCompleted: boolean;
  /** True when this call finished a previous attempt rather than starting one. */
  resumed: boolean;
};

export type ClockOutResult = ClockOutSuccess | ClockOutFailure;

interface RestockItem {
  name: string;
  productId: string;
}

const fail = (
  code: ClockOutErrorCode,
  error: string,
  retryable = false
): ClockOutFailure => ({ success: false, code, error, retryable });

/**
 * The surfaces that render clock state, revalidated on a FAILURE.
 *
 * `finishClockOut` covers the happy path (plus the admin/finance screens). This
 * exists for the two failures that mean "the database has already moved past
 * what your screen is showing": ALREADY_CLOCKED_OUT and NOT_CLOCKED_IN both
 * hand back an error for a job that is, in fact, already finished. Returning
 * without a revalidation left the page serving the payload it was rendered
 * with — so the hero pill stayed on IN PROGRESS while the row said COMPLETED,
 * and the only way out was the manual reload the error text had been reduced to
 * recommending ("refresh the page if you think this is wrong").
 */
function revalidateClockSurfaces(jobId: string): void {
  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/cleaners/my-jobs/${jobId}`);
  revalidatePath(`/cleaners/my-jobs/${jobId}/clock`);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/**
 * Record a failed clock-out where an admin will see it (5.3), and tell them it
 * happened (7.5). Best-effort by construction: a logging failure must never
 * become the thing that stops a cleaner going home, so every path here swallows.
 *
 * Two surfaces, because they answer different questions. The JobLog row is where
 * an admin looks once they already know to look — it lands on that job's
 * Activity timeline beside the clock-ins. The Alert is what tells them to look
 * at all, without waiting for the cleaner to phone in. `notifyAdmins` suppresses
 * a byte-identical alert while the first is still undismissed, so a cleaner
 * tapping Retry four times against the same pooler timeout raises one card, not
 * four — but a DIFFERENT failure on the same job still gets its own.
 */
async function logClockOutFailure(args: {
  jobId: string;
  userId: string;
  userName: string | null;
  code: ClockOutErrorCode;
  errorClass?: string;
  summary: string;
}) {
  const who = args.userName ?? "a cleaner";
  const detail = `${args.code}${args.errorClass ? ` (${args.errorClass})` : ""}`;

  try {
    await db.jobLog.create({
      data: {
        jobId: args.jobId,
        userId: args.userId,
        action: "CLOCK_OUT_FAILED",
        // The code goes in `field` as well as the sentence so the Activity tab
        // and any future filter can group by it without parsing prose.
        field: args.code,
        description:
          `Clock-out failed for ${who} — ${detail}. ${args.summary}`,
      },
    });
  } catch (e) {
    console.error("clock-out failure log", e);
  }

  try {
    // The job number, not the id — an alert an admin cannot act on from the
    // card itself is one they have to go looking for anyway.
    const job = await db.job.findUnique({
      where: { id: args.jobId },
      select: { jobNumber: true },
    });
    await notifyAdmins({
      severity: "WARNING",
      title: `Clock-out failed — job #${job?.jobNumber ?? "?"}`,
      message:
        `${who} could not clock out of job #${job?.jobNumber ?? "?"} — ${detail}. ` +
        `${args.summary} Open the job's Activity tab for the full record.`,
      relatedId: args.jobId,
      relatedType: "job",
    });
  } catch (e) {
    console.error("clock-out failure alert", e);
  }
}

/**
 * Everything that happens AFTER the transaction commits. Every step is
 * idempotent, which is what makes the resume path in `clockOut` safe to run as
 * many times as a cleaner taps Retry:
 *
 *   syncClockMirrors   recomputed from the session rows, not incremented.
 *   the status flip     guarded by `nextStatus !== job.status`.
 *   ensureRatingRequest mints at most one JobRatingToken per job, and only fires
 *                       once everybody has finished.
 *
 * The admin email is the one thing that is NOT idempotent, so the caller decides
 * whether to send it — see `notifyAdmin`.
 */
async function finishClockOut(args: {
  jobId: string;
  jobNumber: number;
  clientName: string;
  jobStatus: string;
  paymentReceived: boolean;
  userId: string;
  userName: string | null;
  sessionStartedAt: Date;
  sessionEndedAt: Date;
  notifyAdmin: boolean;
}): Promise<{ jobCompleted: boolean }> {
  // Recompute the derived clock columns from the session rows. `anyOpen`
  // answers the question the old code never asked: is anybody else still
  // working on this job?
  const mirrors = await syncClockMirrors(args.jobId);

  // THE JOB ONLY FINISHES WHEN EVERYBODY HAS (item 6). Previously the first
  // cleaner to clock out marked the job COMPLETED for the whole crew and set
  // its clockOutTime, while their teammates were still on site.
  const isFinalClockOut = !mirrors.anyOpen;

  // ── Hourly billing: stamp the hours that were actually worked (step 8.5) ───
  //
  // Only on the FINAL clock-out, for the same reason the status flip is: while
  // a teammate is still on site the job's hours are not finished, and billing
  // the customer for a partial figure would be wrong every time a two-person
  // crew clocked out a minute apart.
  //
  // Idempotent and self-guarding: `snapshotBilledActualHours` returns
  // immediately unless `billingType = HOURLY`, and it will not re-price a job
  // whose customer has already paid. Best-effort — a billing snapshot must
  // never be the reason a cleaner cannot clock out.
  if (isFinalClockOut) {
    await snapshotBilledActualHours(args.jobId).catch((e) =>
      console.error("billed-hours snapshot", e)
    );
    // ── Cleaner pay: settle it from the same clock (round 4, fix 5) ──────────
    //
    // The other half of the sentence above. An HOURLY job's `employeePay` was
    // computed once at save time from the SCHEDULED window and never revisited,
    // so a crew that stayed late was paid for hours nobody worked — the PDF's
    // "pay = total clocked hours × cleaner hourly rate". Same guards, same
    // best-effort discipline: it refuses a manual figure, a locked pay period
    // and a job with nothing clocked, and a pay recalculation must never be the
    // reason a cleaner cannot clock out.
    await snapshotHourlyEmployeePay(args.jobId).catch((e) =>
      console.error("hourly-pay snapshot", e)
    );
  }

  if (isFinalClockOut && args.jobStatus !== "CANCELLED") {
    // Paid stays Paid — clock-out must never downgrade a job whose payment
    // was already received.
    const nextStatus =
      args.jobStatus === "PAID" || args.paymentReceived ? "PAID" : "COMPLETED";
    if (nextStatus !== args.jobStatus) {
      await db.job.update({
        where: { id: args.jobId },
        data: { status: nextStatus },
      });
      await db.jobLog.create({
        data: {
          jobId: args.jobId,
          userId: args.userId,
          action: "STATUS_CHANGED",
          field: "status",
          oldValue: args.jobStatus,
          newValue: nextStatus,
          description: `Status changed from ${args.jobStatus} to ${nextStatus}`,
        },
      });
    }
  }

  // Admin email — gated by `admin.clock.clocked_out`. Reports THIS session's
  // length, not the whole job's, so a resume reads as what it was.
  if (args.notifyAdmin) {
    const durationMinutes = Math.max(
      1,
      Math.round(
        (args.sessionEndedAt.getTime() - args.sessionStartedAt.getTime()) / 60000
      )
    );
    sendAdminClockedOut({
      jobId: args.jobId,
      jobNumber: args.jobNumber,
      clientName: args.clientName,
      cleanerName: args.userName ?? "Cleaner",
      durationMinutes,
    }).catch((e) => console.error("admin clocked-out email", e));
  }

  // Customer-facing, and therefore ONCE PER JOB (Decision 4). Only fires when
  // the job is genuinely finished — asking a customer to rate a job that a
  // teammate is still working is wrong, and a second clock-out after a resume
  // must not ask them twice. ensureRatingRequest is itself idempotent (it
  // mints one JobRatingToken per job); the isFinalClockOut guard is the outer
  // half of the same promise.
  if (isFinalClockOut) {
    await ensureRatingRequest(args.jobId).catch((e) =>
      console.error("ensureRatingRequest", e)
    );
  }

  revalidatePath("/cleaners/my-jobs");
  revalidatePath(`/cleaners/my-jobs/${args.jobId}`);
  revalidatePath(`/cleaners/my-jobs/${args.jobId}/clock`);
  revalidatePath(`/admin/jobs/${args.jobId}`);
  revalidatePath(`/admin/employees/${args.userId}`);
  revalidatePath("/admin/time-tracking");
  revalidatePath("/admin/finances");
  revalidatePath("/admin/analytics");
  revalidatePath("/cleaners/my-inventory");

  return { jobCompleted: isFinalClockOut };
}

/**
 * The admin review flag one reported line raises, or null when it is fine.
 *
 * One switch over the three vocabularies, each delegating to the SAME mapping
 * every other writer uses (`src/lib/inventory-status.ts`), so a scraper
 * reported damaged at clock-out and one reported damaged from My Inventory land
 * on an identically-typed flag.
 */
function flagTypeFor(entry: ValidatedReportEntry): InventoryFlagType | null {
  if (entry.kind === "LEVEL") {
    return entry.levelStatus ? levelFlagType(entry.levelStatus) : null;
  }
  if (entry.kind === "CONDITION") {
    return entry.condition ? conditionFlagType(entry.condition) : null;
  }
  return entry.status ? countableStatusFlagType(entry.status) : null;
}

/** The status string written to the history row for one reported line. */
function reportedStatusOf(entry: ValidatedReportEntry): string | null {
  if (entry.kind === "LEVEL") return entry.levelStatus;
  if (entry.kind === "CONDITION") return entry.condition;
  return entry.status;
}

export async function clockOut(
  jobId: string,
  report: ClosingReport
): Promise<ClockOutResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return fail(
      "NOT_AUTHENTICATED",
      "Your session has expired. Sign in again and your entries will still be here."
    );
  }
  const userId = session.user.id;
  const userName = session.user.name ?? null;

  // Declared out here so the catch-all can describe what was submitted even
  // when the throw happened before the kit was loaded.
  let kit: ClockOutKit = new Map();

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
        addOns: true,
      },
    });

    if (!job) {
      return fail("JOB_NOT_FOUND", "That job no longer exists. Refresh your job list.");
    }

    const isEmployee = job.employeeId === userId;
    const isCleaner = job.cleaners.some((c) => c.id === userId);

    /**
     * AN OPEN SESSION OUTRANKS THE ROSTER.
     *
     * Assignment says who SHOULD work the job; an open session is evidence that
     * somebody DID. When the two disagree, the evidence wins — otherwise a
     * roster change made while a cleaner is mid-shift strands them: they are
     * clocked in, the clock is running, and the app refuses to let them stop.
     *
     * Production, job #2150: Priscilla claimed the job, clocked in at 03:39,
     * and was taken off the roster at 03:41 — ninety seconds later, while her
     * session was open. Every clock-out she tried after that was refused with
     * "you are not assigned to this job", and she had no way to end a shift she
     * had genuinely worked. Her hours would have gone unpaid.
     *
     * Safe by construction: this only admits somebody who already has an open
     * `JobWorkSession` on THIS job, which nothing but their own clock-in
     * creates. It widens who may CLOSE a session, never who may open one.
     */
    const strandedSession = !isEmployee && !isCleaner
      ? await findOpenSession(jobId, userId)
      : null;

    if (!isEmployee && !isCleaner && !strandedSession) {
      const failure = fail(
        "NOT_ASSIGNED",
        "You are not assigned to this job, so you can't clock out of it. Ask your manager to add you."
      );
      await logClockOutFailure({
        jobId,
        userId,
        userName,
        code: failure.code,
        summary: describeReportForLog(report, kit),
      });
      return failure;
    }

    // Loaded alongside the kit so a counted-down consumable is judged against
    // the admin's configured floor — the same number the cleaner's My Inventory
    // page uses. This action used to omit it and silently judge kits against
    // the built-in 1.
    const [employeeProducts, kitThresholdDefault] = await Promise.all([
      db.employeeProduct.findMany({
        where: { employeeId: userId },
        include: { product: true },
      }),
      loadCleanerThresholdDefault(),
    ]);
    const epByProductId = new Map(employeeProducts.map((ep) => [ep.productId, ep]));
    kit = new Map(
      employeeProducts.map((ep) => [
        ep.productId,
        {
          productId: ep.productId,
          name: ep.product.name,
          unit: ep.product.unit,
          quantity: ep.quantity,
          // The validator refuses a report written in the wrong vocabulary for
          // the product — a level on a scraper, a condition on a bottle — so it
          // has to know what each kit line IS (Stage 1's classification).
          itemType: ep.product.itemType,
        },
      ])
    );

    // PER CLEANER, not per job (item 6). These two guards used to read the
    // job-level pair, so a teammate's clock-out state decided whether YOU could
    // clock out — and once anybody had, nobody could clock out again.
    const openSession = await findOpenSession(jobId, userId);

    // ── The resume path (5.4) ────────────────────────────────────────────────
    // No open session does NOT necessarily mean "not clocked in". If this
    // cleaner closed one moments ago, this is the retry after a tail failure:
    // the transaction committed, the steps after it did not. Finish those and
    // report success. Nothing here writes inventory, so a cleaner mashing Retry
    // cannot record their report twice.
    if (!openSession) {
      const justClosed = await findRecentlyClosedSession(
        jobId,
        userId,
        CLOCK_OUT_RESUME_WINDOW_MS
      );
      if (!justClosed || !justClosed.endedAt) {
        const failure = fail(
          "NOT_CLOCKED_IN",
          "You're not clocked in on this job. Clock in first, or refresh the page if you think this is wrong."
        );
        await logClockOutFailure({
          jobId,
          userId,
          userName,
          code: failure.code,
          summary: describeReportForLog(report, kit),
        });
        // The screen is out of date with the database — that IS the error.
        revalidateClockSurfaces(jobId);
        return failure;
      }

      // Did the previous attempt's tail actually run? This cleaner's assignment
      // mirror is stamped by syncClockMirrors, so a clockOutTime at or after the
      // session's end means the tail completed and only the response was lost —
      // in which case re-sending the admin email would be the second one.
      const assignment = await db.jobAssignment.findUnique({
        where: { jobId_cleanerId: { jobId, cleanerId: userId } },
        select: { clockOutTime: true },
      });
      const tailAlreadyRan =
        !!assignment?.clockOutTime &&
        assignment.clockOutTime.getTime() >= justClosed.endedAt.getTime();

      // A retry resends the payload the committed attempt already recorded, so
      // skipping it is right and the honest answer is success. But if the tail
      // ALSO ran, that attempt fully succeeded — this is a stale tab submitting
      // again, and if it carries a report, returning success would quietly bin
      // it. Rare, and worth a sentence rather than a lie.
      if (tailAlreadyRan) {
        const resubmitted = validateClosingReport(report, kit);
        if (resubmitted.ok && resubmitted.entries.length > 0) {
          const failure = fail(
            "ALREADY_CLOCKED_OUT",
            "You've already clocked out of this job, so this inventory report was NOT saved a second time. If it still needs recording, update it from My Inventory."
          );
          await logClockOutFailure({
            jobId,
            userId,
            userName,
            code: failure.code,
            summary: describeReportForLog(report, kit),
          });
          // This job IS clocked out — the refusal is only about the duplicate
          // report. Without this the badge kept saying IN PROGRESS.
          revalidateClockSurfaces(jobId);
          return failure;
        }
      }

      const done = await finishClockOut({
        jobId,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        jobStatus: job.status,
        paymentReceived: job.paymentReceived,
        userId,
        userName,
        sessionStartedAt: justClosed.startedAt,
        sessionEndedAt: justClosed.endedAt,
        notifyAdmin: !tailAlreadyRan,
      });

      // The committed attempt already raised whatever flags its report called
      // for, and this call reports nothing new, so there is nothing left to
      // tell the cleaner to restock. Saying `false` here is not a claim that
      // their kit is full — it is the honest answer to "did THIS submission
      // find something low", which is what the banner is for.
      return {
        success: true,
        restockNeeded: false,
        jobCompleted: done.jobCompleted,
        resumed: true,
      };
    }

    // ── Validate before touching anything (5.2) ──────────────────────────────
    // Up front, so a bad row is named rather than surfacing as a TypeError three
    // steps later wearing the blanket string.
    const validated = validateClosingReport(report, kit);
    if (!validated.ok) {
      let failure = validated.failure;
      // The validator can't name a product it was never given; the catalogue can.
      if (failure.code === "PRODUCT_NOT_IN_KIT" && failure.field) {
        const product = await db.product.findUnique({
          where: { id: failure.field.productId },
          select: { name: true },
        });
        if (product) {
          failure = {
            ...failure,
            field: { productId: failure.field.productId, name: product.name },
            error: `“${product.name}” is no longer assigned to you. Refresh the page to pick up your current kit, then clock out again.`,
          };
        }
      }
      await logClockOutFailure({
        jobId,
        userId,
        userName,
        code: failure.code,
        summary: describeReportForLog(report, kit),
      });
      return failure;
    }

    const now = new Date();
    const entries = validated.entries;

    // ── What each reported line means, decided before a statement is built ────
    //
    // NOTE WHAT IS NOT HERE ANY MORE: there is no deduction plan, no ml
    // conversion, no `costPerUnit` multiplication and no supplies budget
    // category. A LEVEL or CONDITION line moves nothing; a COUNT line sets the
    // kit to the number the cleaner reported. Estimated usage is gone (PDF #2),
    // and with it the per-job supplies expense it was priced into (decision D2).
    const restockNeeded: RestockItem[] = [];
    const flagsWanted: Array<{ productId: string; type: InventoryFlagType; note: string | null }> = [];

    for (const entry of entries) {
      const ep = epByProductId.get(entry.productId);
      let flagType = flagTypeFor(entry);

      // A COUNT with no chip on it is still judged against the admin's refill
      // threshold — the cleaner counting three gloves left is exactly the case
      // the old "You are low on X" alert existed for, and it would be a poor
      // trade to lose it because they didn't also tap "Low". The cleaner's own
      // word wins where they gave one; silence gets the arithmetic.
      //
      // `isCleanerLow` is type-aware (Stage 2), so a tool can never reach this
      // however it is counted, and the threshold default is the admin's
      // configured floor rather than the built-in 1.
      if (
        !flagType &&
        entry.kind === "COUNT" &&
        entry.status === null &&
        ep &&
        isCleanerLow(entry.quantity, {
          cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
          defaultThreshold: kitThresholdDefault,
          itemType: ep.product.itemType,
        })
      ) {
        flagType = "LOW";
      }

      if (flagType) {
        flagsWanted.push({ productId: entry.productId, type: flagType, note: entry.note });
      }

      // The cleaner-facing "refill before your next job" nudge. Consumables
      // only, since a tool is never restocked (PDF #4) — and LOW/EMPTY are the
      // only two flag types a consumable can raise that mean "go and get more".
      if (
        entry.kind !== "CONDITION" &&
        (flagType === "LOW" || flagType === "EMPTY")
      ) {
        restockNeeded.push({ name: entry.name, productId: entry.productId });
      }
    }

    // De-dupe against what is ALREADY open for this cleaner. Read outside the
    // transaction on purpose: the array form of `$transaction` takes prepared
    // promises, not a callback. Two clock-outs landing in the same millisecond
    // could still produce a duplicate flag — an admin resolving one twice is a
    // far smaller problem than a report that silently never reaches the queue.
    // (Same trade-off, and the same wording, as `reportDamagedItem`.)
    const openFlags =
      entries.length > 0
        ? await db.inventoryFlag.findMany({
            where: {
              employeeId: userId,
              status: "OPEN",
              productId: { in: entries.map((e) => e.productId) },
            },
            select: { id: true, productId: true, type: true, notes: true },
          })
        : [];

    const wantedByProduct = new Map(flagsWanted.map((f) => [f.productId, f]));
    const flagsToCreate = flagsWanted.filter(
      (want) =>
        !openFlags.some(
          (open) => open.productId === want.productId && open.type === want.type
        )
    );
    // Everything else open against a product this report touched is stale: the
    // cleaner has just told us the current state, and it is not that. Without
    // this the queue only ever grows and an admin cannot tell a live problem
    // from one that was fixed three jobs ago.
    const staleFlagIds = openFlags
      .filter((open) => wantedByProduct.get(open.productId)?.type !== open.type)
      .map((open) => open.id);
    // A repeat report of the SAME problem refreshes the note rather than
    // stacking a second identical row in front of an admin. Only when the new
    // report actually carries one: re-reporting a damaged scraper with no note
    // must not erase the note that explained what happened to it.
    const flagsToRenote = openFlags.filter((open) => {
      const want = wantedByProduct.get(open.productId);
      return want?.type === open.type && !!want.note && want.note !== open.notes;
    });

    // Rag-wash projection per the Self-Wash spec. Capped credits are awarded
    // once per job (washCreditsAwarded flag) and divided across assigned
    // cleaners so two cleaners on one job split the rag/pad pool fairly.
    const projection = projectWashables({
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      jobType: job.jobType,
      addOnNames: job.addOns.map((a) => a.name),
    });

    const cleanerIdsForCredit = (() => {
      const ids = new Set<string>();
      if (job.employeeId) ids.add(job.employeeId);
      for (const c of job.cleaners) ids.add(c.id);
      return Array.from(ids);
    })();

    // ── The transaction (5.6) ────────────────────────────────────────────────
    // The two append-only audit writes are single `createMany` calls covering
    // every reported item at once (and the CLOCKED_OUT entry rides along in the
    // same one). What used to be four statements per product is now at most one
    // — the kit update, and only for a COUNT line whose number actually moved.
    //
    // GONE, and deliberately: `jobProductUsage.upsert` (the estimated-usage row)
    // and the supplies `Transaction` it was priced into. The tables are left in
    // place and readable — old rows are labelled "Legacy estimated usage" in the
    // activity log (decision D4) — nothing writes them any more.
    /**
     * The clock-out write, as steps rather than as started queries.
     *
     * This was `Prisma.PrismaPromise<unknown>[]`, handed to
     * `db.$transaction(ops)`. Both halves of that were wrong on the tenant
     * client, and it broke clock-out outright at the multi-tenant cutover:
     *
     *   - the array form is rejected on purpose (see org-db.ts) — it needs
     *     deferred Prisma promises, and this client runs eagerly;
     *   - running eagerly, every `db.x.y(...)` below had ALREADY executed by
     *     the time it was pushed, each in its own transaction. So the throw
     *     came after the writes, leaving a half-applied clock-out and telling
     *     the cleaner it had failed.
     *
     * Steps, taken in order inside one interactive transaction, are the shape
     * this client supports: the tenant is announced once and either the whole
     * clock-out lands or none of it does.
     */
    const ops: ((tx: ScopedTx) => Promise<unknown>)[] = [];
    const inventoryChanges: Prisma.InventoryChangeCreateManyInput[] = [];
    const jobLogs: Prisma.JobLogCreateManyInput[] = [];

    for (const entry of entries) {
      const ep = epByProductId.get(entry.productId);
      // Unreachable: the validator only ever emits kit products. Kept because a
      // non-null assertion here would be a promise the type system can't hold.
      if (!ep) continue;

      const reportedStatus = reportedStatusOf(entry);
      const quantityMoved = entry.kind === "COUNT" && entry.quantity !== entry.previousQuantity;
      const previousStatus =
        entry.kind === "LEVEL"
          ? ep.levelStatus
          : entry.kind === "CONDITION"
            ? ep.condition
            : null;

      // The kit row. `statusUpdatedAt` is stamped for every reported line —
      // including a COUNT with no chip — because "when did anyone last look at
      // this" is a question the admin surfaces ask of all three types.
      ops.push((tx) =>
        tx.employeeProduct.update({
          where: { id: ep.id },
          data: {
            ...(entry.kind === "COUNT" ? { quantity: entry.quantity } : {}),
            ...(entry.kind === "LEVEL" ? { levelStatus: entry.levelStatus } : {}),
            ...(entry.kind === "CONDITION" ? { condition: entry.condition } : {}),
            statusUpdatedAt: now,
            statusNotes: entry.note,
          },
        })
      );

      // History — the exact list PDF #1 asks for: cleaner, job, item, previous
      // status, new status, timestamp, note. `quantityChange` is 0 for a level
      // or condition report because nothing moved, and saying "nothing moved"
      // is the honest value for a non-null column.
      inventoryChanges.push({
        productId: entry.productId,
        employeeId: userId,
        employeeName: userName,
        quantityChange: quantityMoved ? entry.quantity - entry.previousQuantity : 0,
        newQuantity: entry.quantity,
        unit: entry.unit,
        action: "JOB_REPORT",
        previousStatus,
        newStatus: reportedStatus,
        reason:
          `Reported at clock-out on job #${job.jobNumber}` +
          (reportedStatus ? `: ${statusLabel(reportedStatus)}` : "") +
          (entry.kind === "COUNT" ? ` — ${entry.quantity} ${entry.unit} left` : "") +
          (entry.note ? ` — ${entry.note}` : ""),
        changedById: userId,
        changedByName: userName,
      });

      jobLogs.push({
        jobId,
        userId,
        // PRODUCT_USED is the closest existing verb and the one the job's
        // Activity timeline already renders. It no longer means "this much was
        // consumed" — the description says what was reported, which is all
        // anybody ever actually knew.
        action: "PRODUCT_USED",
        description:
          `Reported ${entry.name}: ` +
          (entry.kind === "COUNT"
            ? `${entry.quantity} ${entry.unit} left${entry.status ? ` (${statusLabel(entry.status)})` : ""}`
            : `${statusLabel(reportedStatus)}`),
      });
    }

    jobLogs.push({
      jobId,
      userId,
      action: "CLOCKED_OUT",
      description: `${userName ?? "Cleaner"} clocked out`,
    });

    if (inventoryChanges.length > 0) {
      ops.push((tx) => tx.inventoryChange.createMany({ data: inventoryChanges }));
    }
    ops.push((tx) => tx.jobLog.createMany({ data: jobLogs }));

    // ── The admin review queue (PDF #1/#2) ───────────────────────────────────
    // One create for everything new, one update closing everything stale, and a
    // note refresh for anything already open on the same problem.
    if (flagsToCreate.length > 0) {
      ops.push((tx) =>
        tx.inventoryFlag.createMany({
          data: flagsToCreate.map((f) => ({
            type: f.type,
            employeeId: userId,
            productId: f.productId,
            jobId,
            source: "CLOCK_OUT",
            notes: f.note,
          })),
        })
      );
    }
    if (staleFlagIds.length > 0) {
      ops.push((tx) =>
        tx.inventoryFlag.updateMany({
          where: { id: { in: staleFlagIds } },
          data: { status: "RESOLVED", resolvedAt: now, resolvedById: userId },
        })
      );
    }
    for (const open of flagsToRenote) {
      ops.push((tx) =>
        tx.inventoryFlag.update({
          where: { id: open.id },
          data: { notes: wantedByProduct.get(open.productId)?.note ?? null },
        })
      );
    }

    // Close THIS cleaner's running session. The clock columns are recomputed
    // from every session on the job after the transaction — including
    // Job.clockOutTime, which stays NULL while a teammate is still working.
    ops.push((tx) =>
      tx.jobWorkSession.update({
        where: { id: openSession.id },
        data: { endedAt: now },
      })
    );

    // Wash projection is recomputed on EVERY clock-out (Decision 4) — the
    // inputs don't change, so it is idempotent. The credit AWARD flag is
    // separately once-per-job and already guarded.
    ops.push((tx) =>
      tx.job.update({
        where: { id: jobId },
        data: {
          washProjectedRags: projection.projectedRags,
          washProjectedPads: projection.projectedPads,
          washCappedRags: projection.cappedRags,
          washCappedPads: projection.cappedPads,
          // Note: actuals aren't reported at clock-out; cleaner logs them via
          // /my-inventory/rag-wash. We mark the *award* as done so we don't
          // double-credit on repeated clock-outs.
          washCreditsAwarded:
            !job.washCreditsAwarded && cleanerIdsForCredit.length > 0
              ? true
              : job.washCreditsAwarded,
        },
      })
    );

    // Any break still running is closed at clock-out (item 26). Left open it
    // would never end, and the job's active working time would keep shrinking
    // as the clock ran on.
    ops.push((tx) =>
      tx.jobBreak.updateMany({
        where: { jobId, cleanerId: userId, endedAt: null },
        data: { endedAt: now },
      })
    );

    // Rag/pad credit accrual is DISABLED for now (fix 5: "rag wash should not
    // affect cleaner pay, credits, or payroll"). Clock-out no longer increments
    // User.ragCredits/padCredits. The wash projection fields are still written
    // above so the underlying data stays intact for a future reintroduction;
    // they simply feed nothing on the cleaner side anymore.
    // (Previously: awarded ragShare/padShare to each assigned cleaner here.)
    void cleanerIdsForCredit;

    // NOTE: the per-job supplies `Transaction` used to be created here. Its
    // amount was `used × costPerUnit`, where `used` came from the estimated
    // Light/Medium/Heavy conversion — so it priced a guess and posted it to the
    // job's P&L as a measured cost. Removed with the estimate itself (decision
    // D2): supplies are a warehouse-level cost, tracked when stock is bought
    // and restocked, not apportioned per job from a number nobody counted.
    // The owner-facing note is docs/reference/INVENTORY_REPORTING_CHANGE.md.

    // Per spec: one combined cleaner-facing restock alert when ≥1 item is low.
    if (restockNeeded.length > 0) {
      const names = restockNeeded.map((r) => r.name);
      const list =
        names.length === 1
          ? names[0]
          : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
      const message =
        names.length === 1
          ? `You reported ${list} as low or empty. Please refill it from the storage locker before your next job.`
          : `You reported ${list} as low or empty. Please refill these items from the storage locker before your next job.`;

      ops.push((tx) =>
        tx.alert.create({
          data: {
            type: "PROVIDER_LOW_STOCK",
            severity: "WARNING",
            title: "Restock needed before your next job",
            message,
            recipientUserId: userId,
            relatedId: jobId,
            relatedType: "Job",
          },
        })
      );
    }

    await db.$transaction(async (tx) => {
      for (const op of ops) await op(tx);
    });

    // From here the shift IS saved. A failure below must never be reported as
    // "nothing happened" — it gets its own code, and Retry lands on the resume
    // path above rather than re-recording anything a second time.
    try {
      const done = await finishClockOut({
        jobId,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        jobStatus: job.status,
        paymentReceived: job.paymentReceived,
        userId,
        userName,
        sessionStartedAt: openSession.startedAt,
        sessionEndedAt: now,
        notifyAdmin: true,
      });

      return {
        success: true,
        restockNeeded: restockNeeded.length > 0,
        jobCompleted: done.jobCompleted,
        resumed: false,
      };
    } catch (error) {
      console.error("Clock-out saved but post-steps failed:", error);
      await logClockOutFailure({
        jobId,
        userId,
        userName,
        code: "SYNC_INCOMPLETE",
        errorClass: clockOutErrorClass(error),
        summary: describeReportForLog(report, kit),
      });
      return fail(
        "SYNC_INCOMPLETE",
        "Your clock-out was saved, but we couldn't finish closing the job. Tap Retry to finish it — nothing will be counted twice.",
        true
      );
    }
  } catch (error) {
    console.error("Error clocking out:", clockOutErrorClass(error), error);
    const classified = classifyClockOutError(error);
    await logClockOutFailure({
      jobId,
      userId,
      userName,
      code: classified.code,
      errorClass: clockOutErrorClass(error),
      summary: describeReportForLog(report, kit),
    });
    return classified;
  }
}
