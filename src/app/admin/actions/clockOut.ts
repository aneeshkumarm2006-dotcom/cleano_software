"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { projectWashables } from "@/lib/wash";
import { notifyAdmins } from "@/lib/admin-alerts";
import { sendAdminClockedOut } from "@/lib/email";
import { ensureRatingRequest } from "@/lib/rating";
import { isCleanerLow } from "@/lib/inventory-thresholds";
import {
  findOpenSession,
  findRecentlyClosedSession,
  syncClockMirrors,
} from "@/lib/work-sessions.server";
import { requireBudgetCategoryId } from "@/lib/budget-categories";
import {
  CLOCK_OUT_RESUME_WINDOW_MS,
  classifyClockOutError,
  clockOutErrorClass,
  describeUsageForLog,
  validateClockOutUsage,
  type ClockOutErrorCode,
  type ClockOutFailure,
  type ClockOutKit,
  type ClockOutUsage,
} from "@/lib/clock-out";

/**
 * Cleaner clock-out — cleano_new_fixes.pdf fix 6 (`_ai_context/TODO.md` Stage 5).
 *
 * ## What was wrong
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
 * ## What it is now
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
 *   SMALLER     per-product statements halved (see the transaction note below).
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

/** One product's worth of work, decided before a single statement is built. */
interface PlannedDeduction {
  employeeProductId: string;
  productId: string;
  name: string;
  unit: string;
  inventoryBefore: number;
  inventoryAfter: number;
  used: number;
  cost: number;
}

const fail = (
  code: ClockOutErrorCode,
  error: string,
  retryable = false
): ClockOutFailure => ({ success: false, code, error, retryable });

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

export async function clockOut(
  jobId: string,
  usage: ClockOutUsage
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
    if (!isEmployee && !isCleaner) {
      const failure = fail(
        "NOT_ASSIGNED",
        "You are not assigned to this job, so you can't clock out of it. Ask your manager to add you."
      );
      await logClockOutFailure({
        jobId,
        userId,
        userName,
        code: failure.code,
        summary: describeUsageForLog(usage, kit),
      });
      return failure;
    }

    const employeeProducts = await db.employeeProduct.findMany({
      where: { employeeId: userId },
      include: { product: true },
    });
    const epByProductId = new Map(employeeProducts.map((ep) => [ep.productId, ep]));
    kit = new Map(
      employeeProducts.map((ep) => [
        ep.productId,
        {
          productId: ep.productId,
          name: ep.product.name,
          unit: ep.product.unit,
          quantity: ep.quantity,
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
    // cannot deduct their kit twice.
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
          summary: describeUsageForLog(usage, kit),
        });
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
      // again, and if it carries usage, returning success would quietly bin it.
      // Rare, and worth a sentence rather than a lie.
      if (tailAlreadyRan) {
        const resubmitted = validateClockOutUsage(usage, kit);
        if (resubmitted.ok && resubmitted.deductions.size > 0) {
          const failure = fail(
            "ALREADY_CLOCKED_OUT",
            "You've already clocked out of this job, so this product usage was NOT added a second time. If it still needs logging, record it from My Inventory."
          );
          await logClockOutFailure({
            jobId,
            userId,
            userName,
            code: failure.code,
            summary: describeUsageForLog(usage, kit),
          });
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

      // Deductions already happened; report restock from what the kit holds NOW
      // so a resumed clock-out still tells the cleaner to refill.
      const stillLow = employeeProducts.some((ep) =>
        isCleanerLow(ep.quantity, {
          cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
        })
      );

      return {
        success: true,
        restockNeeded: stillLow,
        jobCompleted: done.jobCompleted,
        resumed: true,
      };
    }

    // ── Validate before touching anything (5.2) ──────────────────────────────
    // Up front, so a bad row is named rather than surfacing as a TypeError three
    // steps later wearing the blanket string.
    const validated = validateClockOutUsage(usage, kit);
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
            error: `“${product.name}” is no longer assigned to you. Set it back to “None”, or refresh the page to pick up your current kit, then clock out again.`,
          };
        }
      }
      await logClockOutFailure({
        jobId,
        userId,
        userName,
        code: failure.code,
        summary: describeUsageForLog(usage, kit),
      });
      return failure;
    }

    const now = new Date();

    // Plan every deduction BEFORE building a single statement, so the supplies
    // cost — and therefore whether the budget category is needed at all — is
    // known before the transaction is assembled.
    const plan: PlannedDeduction[] = [];
    const restockNeeded: RestockItem[] = [];
    let suppliesCost = 0;

    for (const [productId, requested] of validated.deductions) {
      const ep = epByProductId.get(productId);
      // Unreachable: the validator only ever emits kit products. Kept because a
      // non-null assertion here would be a promise the type system can't hold.
      if (!ep) continue;

      const inventoryBefore = ep.quantity;
      const inventoryAfter = Math.max(0, inventoryBefore - requested);
      const used = inventoryBefore - inventoryAfter;
      if (used <= 0) continue;

      const cost = used * ep.product.costPerUnit;
      suppliesCost += cost;
      plan.push({
        employeeProductId: ep.id,
        productId,
        name: ep.product.name,
        unit: ep.product.unit,
        inventoryBefore,
        inventoryAfter,
        used,
        cost,
      });

      // Restock alert fires when the CLEANER's kit hits THEIR threshold.
      // This used to fall back to `minStock` — the company reorder point — so a
      // cleaner was judged against a warehouse number (fix list item 14).
      if (
        isCleanerLow(inventoryAfter, {
          cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
        })
      ) {
        restockNeeded.push({ name: ep.product.name, productId });
      }
    }

    // Resolved here, deliberately, and not inline in the ops array (5.4).
    // `requireBudgetCategoryId` self-heals a missing row, i.e. it can WRITE —
    // and a write sitting in the middle of transaction assembly is one more
    // thing that can throw after some decisions have been made and none of them
    // recorded. Zero-cost clock-outs never call it at all.
    const suppliesCategoryId =
      suppliesCost > 0 ? await requireBudgetCategoryId("supplies") : null;

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
    // Was FOUR statements per product — usage upsert, stock update,
    // inventoryChange, jobLog — plus a tail, so a 20-product kit assembled 86
    // statements. The two append-only audit writes are now single `createMany`
    // calls covering every product at once (and the CLOCKED_OUT entry rides
    // along in the same one), taking the worst case to ~47 and the median to 9.
    //
    // `jobProductUsage` moved from find-then-create/update to an upsert with
    // `increment`. JobProductUsage is unique on (jobId, productId), so the old
    // read-then-write lost that race between two cleaners clocking out of the
    // same job at once — and losing it meant a unique-constraint violation that
    // failed the whole transaction and printed “Failed to clock out”.
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const inventoryChanges: Prisma.InventoryChangeCreateManyInput[] = [];
    const jobLogs: Prisma.JobLogCreateManyInput[] = [];

    for (const d of plan) {
      ops.push(
        db.jobProductUsage.upsert({
          where: { jobId_productId: { jobId, productId: d.productId } },
          create: {
            jobId,
            productId: d.productId,
            quantity: d.used,
            inventoryBefore: d.inventoryBefore,
            inventoryAfter: d.inventoryAfter,
          },
          update: {
            quantity: { increment: d.used },
            inventoryBefore: d.inventoryBefore,
            inventoryAfter: d.inventoryAfter,
          },
        })
      );

      // Deduct from employee stock.
      ops.push(
        db.employeeProduct.update({
          where: { id: d.employeeProductId },
          data: { quantity: d.inventoryAfter },
        })
      );

      // Audit row — job usage must appear in the inventory activity log
      // alongside assignments, pickups and adjustments (fix list item 18).
      // Without this the log silently omitted the single biggest source of
      // stock movement: product actually consumed on jobs.
      inventoryChanges.push({
        productId: d.productId,
        employeeId: userId,
        employeeName: userName,
        quantityChange: -d.used,
        newQuantity: d.inventoryAfter,
        unit: d.unit,
        reason: `Used on job #${job.jobNumber}`,
        changedById: userId,
        changedByName: userName,
      });

      jobLogs.push({
        jobId,
        userId,
        action: "PRODUCT_USED",
        description: `Used ${d.used.toFixed(2)} ${d.unit} of ${d.name}`,
      });
    }

    jobLogs.push({
      jobId,
      userId,
      action: "CLOCKED_OUT",
      description: `${userName ?? "Cleaner"} clocked out`,
    });

    if (inventoryChanges.length > 0) {
      ops.push(db.inventoryChange.createMany({ data: inventoryChanges }));
    }
    ops.push(db.jobLog.createMany({ data: jobLogs }));

    // Close THIS cleaner's running session. The clock columns are recomputed
    // from every session on the job after the transaction — including
    // Job.clockOutTime, which stays NULL while a teammate is still working.
    ops.push(
      db.jobWorkSession.update({
        where: { id: openSession.id },
        data: { endedAt: now },
      })
    );

    // Wash projection is recomputed on EVERY clock-out (Decision 4) — the
    // inputs don't change, so it is idempotent. The credit AWARD flag is
    // separately once-per-job and already guarded.
    ops.push(
      db.job.update({
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
    ops.push(
      db.jobBreak.updateMany({
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

    if (suppliesCategoryId) {
      ops.push(
        db.transaction.create({
          data: {
            date: now,
            categoryId: suppliesCategoryId,
            amount: suppliesCost,
            description: `Supplies consumed for ${job.clientName}`,
            jobId,
            source: "AUTO_CLOCK_OUT",
            isAuto: true,
          },
        })
      );
    }

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
          ? `You are low on ${list}. Please refill it from the storage locker before your next job.`
          : `You are low on ${list}. Please refill these items from the storage locker before your next job.`;

      ops.push(
        db.alert.create({
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

    await db.$transaction(ops);

    // From here the shift IS saved. A failure below must never be reported as
    // "nothing happened" — it gets its own code, and Retry lands on the resume
    // path above rather than deducting anything a second time.
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
        summary: describeUsageForLog(usage, kit),
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
      summary: describeUsageForLog(usage, kit),
    });
    return classified;
  }
}
