"use server";

import { db } from "@/lib/org-db";
import { getActor } from "@/lib/action-guards";
import { computeJobMoney } from "@/lib/job-money";
import {
  computeJobPayShares,
  type JobPayInput,
  type JobPayShare,
} from "@/lib/cleaner-earnings";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { resolveAmountDue } from "@/lib/job-billing";
import { getTaxRates } from "@/lib/tax.server";
import { formatDate, formatTime } from "@/lib/timezone";
import { formatAddressLine } from "@/lib/client-address";
import { jobTypeLabel } from "@/lib/calendar-labels";
import type {
  JobSummaryDTO,
  JobSummaryPayRow,
  JobSummaryResult,
} from "./getJobSummary.types";

/**
 * Fetch-on-open payload for the calendar job drawer (client feedback item 8).
 *
 * Deliberately a SEPARATE query from the month/day feed rather than more
 * columns on it. `getJobsForDay` runs once per visible day and its result is
 * cached per range by SWR; widening it to carry email, phone, taxes, deposit
 * and per-cleaner pay would put ~30 extra columns × every job in the month on
 * the wire to render a panel that shows one job at a time. Fetching on open
 * also means the drawer is never stale relative to an edit made elsewhere.
 * (OPEN-QUESTIONS Q2 §6.)
 */
export async function getJobSummary(jobId: string): Promise<JobSummaryResult> {
  const { userId, role } = await getActor();
  if (!userId) return { success: false, error: "Not authenticated" };
  // Money, client contact details and per-cleaner pay all live in this payload,
  // so it is office-staff only — the same audience the admin calendar is. A
  // cleaner never reaches this component (role EMPLOYEE renders
  // CleanerCalendarClient instead), and item 10 says billing text must not
  // reach them, so there is deliberately no assigned-cleaner branch here.
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }
  if (typeof jobId !== "string" || !jobId.trim()) {
    return { success: false, error: "Job id is required" };
  }

  try {
    const job = await db.job.findFirst({
      where: { id: jobId.trim(), deletedAt: null },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        // Round 4, fix 6 — the drawer states the hold reason and releases it.
        holdReason: true,
        quoteStatus: true,
        jobType: true,
        description: true,
        startTime: true,
        endTime: true,
        // The remaining `JOB_PAY_SELECT` scalars, so `computeJobPayShares`
        // below sees the same row payroll does. `employeeId` in particular is
        // the job's LEAD, who is a participant whether or not they also appear
        // in `cleaners`.
        employeeId: true,
        jobDate: true,
        clockInTime: true,
        clockOutTime: true,

        clientName: true,
        clientId: true,
        client: { select: { email: true, phone: true } },

        location: true,
        aptNumber: true,
        postalCode: true,
        clientAddressId: true,

        parentJobId: true,
        requiredCleaners: true,
        bedCount: true,
        bathCount: true,
        halfBathCount: true,
        squareFootage: true,
        // Stage 9 — printed in the drawer AND used to seed the edit modal.
        propertyType: true,
        // Pinned checklist template (Stage 10) — the calendar edit modal needs
        // it or it un-pins the job on save.
        checklistTemplateId: true,
        cleaners: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true } },
        assignments: {
          select: { cleanerId: true, status: true, payAmount: true },
        },
        // The clock (round 4, fix 5). `computeJobPayShares` settles an HOURLY
        // job from each cleaner's own sessions, so the drawer needs the same
        // rows payroll reads or it prints the even split of a stored total —
        // the exact class of stale figure the note beside `payShares` below
        // documents this drawer for having printed before.
        workSessions: {
          select: { cleanerId: true, startedAt: true, endedAt: true },
        },
        breaks: { select: { cleanerId: true, startedAt: true, endedAt: true } },

        // Money — every column computeJobMoney reads, plus the payment state
        // the drawer's quick-glance row shows.
        price: true,
        discountAmount: true,
        discountReason: true,
        subtotalAmount: true,
        gstAmount: true,
        qstAmount: true,
        totalAmount: true,
        isCashJob: true,
        taxExempt: true,
        bookingSource: true,
        pricingMode: true,
        addOns: { select: { name: true, price: true, quantity: true } },
        paymentType: true,
        paymentReceived: true,
        invoiceSent: true,
        paidAt: true,
        depositPaid: true,
        // Stage 11: `resolveAmountDue` credits the deposit the job actually
        // charged. Omitting this here would quote a $200 post-construction
        // deposit as $20 on the calendar modal and the Charge button.
        depositAmount: true,
        refundedAmount: true,
        tipAmount: true,
        totalTip: true,
        parking: true,
        employeePay: true,
        employeePayIsManual: true,
        payType: true,
        hourlyRate: true,
        // Customer-side hourly billing (Stage 8). Load-bearing twice over:
        // `computeJobMoney` below derives the service line from them, and the
        // drawer's Edit button seeds JobModal from this DTO — without them the
        // modal would open a HOURLY job on Flat and reset it on save.
        billingType: true,
        billedHourlyRate: true,
        billedEstimatedHours: true,
        billedActualHours: true,
        stripePaymentMethodId: true,

        notes: true,
        cancellationReason: true,
        _count: { select: { photos: true } },
      },
    });

    if (!job) return { success: false, error: "Job not found" };

    // ── Frequency. `Job` has never stored one (see saveJob's recurrence
    // generator): a series is a PARENT row plus N children linked by
    // parentJobId, so the only honest answer is the job's position in its own
    // series. Counting from the root — not from `parentJobId != null` — is what
    // stops the parent visit being reported as one-time (Q7 §4 records the same
    // off-by-one in the analytics tile).
    const rootId = job.parentJobId ?? job.id;
    const siblings = await db.job.findMany({
      where: {
        deletedAt: null,
        OR: [{ id: rootId }, { parentJobId: rootId }],
      },
      select: { id: true, startTime: true },
      orderBy: { startTime: "asc" },
    });
    const isRecurring = siblings.length > 1;
    const occurrence = siblings.findIndex((s) => s.id === job.id) + 1;
    const frequencyLabel = isRecurring
      ? `Recurring · visit ${occurrence || 1} of ${siblings.length}`
      : "One-time";

    const rates = await getTaxRates();
    const money = computeJobMoney(job, rates);

    // Per-cleaner pay, from the SAME function payroll, the Financials tab and
    // the cleaner's own My Pay screen use.
    //
    // This used to read `JobAssignment.payAmount` and call it "the payroll
    // split". It is not: `payAmount` is the MANUAL PER-CLEANER OVERRIDE ("I
    // promised Sam $70 of this $100 job"), and it is null on almost every job.
    // The drawer therefore fell through to printing raw `Job.employeePay`
    // labelled "(job total)" — and on a PERCENTAGE job that column is a
    // SAVE-TIME ESTIMATE (`employeePayIsManual: false`), which the schema is
    // explicit about being superseded silently by the live calculation. So an
    // hourly job whose price was recomputed at clock-out kept showing the crew
    // the PRE-clock-out estimate for ever: $96 (40% of the original 4 × $60)
    // beside a Financials tab correctly reading $6 (40% of the actual 0.25h).
    const participantIds = Array.from(
      new Set(
        [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
          (id): id is string => !!id
        )
      )
    );
    const payShares =
      participantIds.length > 0
        ? computeJobPayShares(
            job as unknown as JobPayInput,
            await getCleanerRateInputs(participantIds)
          )
        : new Map<string, JobPayShare>();

    // Assignment rows still carry the crew's CLOCK status for the row beside
    // each name — that part was always right.
    const assignmentByCleaner = new Map(
      job.assignments.map((a) => [a.cleanerId, a])
    );

    // Everyone this job PAYS, in the order the drawer prints them (fix 11).
    // Built off the SHARE MAP, not `job.cleaners`: `participantIds` above
    // includes the LEAD, who is paid whether or not they are also on the
    // roster — and the drawer, which only ever mapped the roster, showed that
    // lead's pay nowhere. Each row carries the three components separately, the
    // same presentation the job page's Financials tab uses.
    const payRows: JobSummaryPayRow[] = [];
    const pushPayRow = (id: string, name: string, isLead: boolean) => {
      const share = payShares.get(id);
      if (!share || payRows.some((r) => r.cleanerId === id)) return;
      const assignment = assignmentByCleaner.get(id);
      payRows.push({
        cleanerId: id,
        name,
        status: assignment?.status ?? null,
        isLead,
        // Already rounded to cents by computeJobPayShares — rounding again here
        // is how the drawer would start disagreeing with payroll by a cent.
        amount: share.base,
        tip: share.tip,
        parking: share.parking,
        total: share.total,
        isOverride: assignment?.payAmount != null,
        basis: share.basis,
        basisLabel: share.basisLabel,
      });
    };
    if (job.employeeId && job.employee) {
      pushPayRow(job.employeeId, job.employee.name, true);
    }
    for (const c of job.cleaners) pushPayRow(c.id, c.name, false);

    const start = job.startTime;
    // Live rows exist where endTime equals startTime (the admin form's end
    // fields were left blank and saveJob mirrored the start). Treat those as
    // "no end" rather than printing "11:00 AM – 11:00 AM".
    const end =
      job.endTime && job.endTime.getTime() > start.getTime()
        ? job.endTime
        : null;
    const durationHours = end
      ? (end.getTime() - start.getTime()) / 3_600_000
      : null;

    const dto: JobSummaryDTO = {
      id: job.id,
      jobNumber: job.jobNumber,
      status: job.status,
      holdReason: job.holdReason,
      quoteStatus: job.quoteStatus,
      jobType: job.jobType,
      serviceLabel: job.jobType ? jobTypeLabel(job.jobType) : "Cleaning",
      description: job.description,

      startTimeIso: start.toISOString(),
      endTimeIso: end ? end.toISOString() : null,
      dateLabel: formatDate(start, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      timeLabel: end
        ? `${formatTime(start)} – ${formatTime(end)}`
        : formatTime(start),
      durationLabel:
        durationHours != null && durationHours > 0
          ? `${Math.round(durationHours * 10) / 10}h`
          : null,

      clientName: job.clientName,
      clientId: job.clientId,
      clientEmail: job.client?.email ?? null,
      clientPhone: job.client?.phone ?? null,

      location: job.location,
      aptNumber: job.aptNumber,
      postalCode: job.postalCode,
      clientAddressId: job.clientAddressId,
      addressLine: formatAddressLine({
        address: job.location,
        aptNumber: job.aptNumber,
        postalCode: job.postalCode,
      }),

      frequencyLabel,
      isRecurring,
      requiredCleaners: job.requiredCleaners,
      bedCount: job.bedCount,
      bathCount: job.bathCount,
      halfBathCount: job.halfBathCount,
      squareFootage: job.squareFootage,
      propertyType: job.propertyType,
      checklistTemplateId: job.checklistTemplateId,
      cleaners: job.cleaners.map((c) => ({
        id: c.id,
        name: c.name,
        status: assignmentByCleaner.get(c.id)?.status ?? null,
        // `total` — the whole payout, exactly as this cleaner's `payRows` entry
        // states it. It used to be `base`, which silently disagreed with the job
        // page's Team card by the cleaner's tip and parking share.
        pay: payShares.get(c.id)?.total ?? null,
      })),
      leadEmployee: job.employee ?? null,
      payRows,

      money,
      // The figure the drawer prints beside "Charge card" — what Stripe will
      // take, not what the job is worth (fix 3 item 3.2).
      amountDue: resolveAmountDue(job),
      price: job.price,
      discountAmount: job.discountAmount,
      discountReason: job.discountReason,
      taxExempt: job.taxExempt,
      paymentType: job.paymentType,
      isCashJob: job.isCashJob,
      paymentReceived: job.paymentReceived,
      invoiceSent: job.invoiceSent,
      paidAtLabel: job.paidAt
        ? `Paid ${formatDate(job.paidAt, { month: "short", day: "numeric" })}`
        : null,
      depositPaid: job.depositPaid,
      depositAmount: job.depositAmount,
      refundedAmount: job.refundedAmount,
      tipAmount: job.tipAmount,
      totalTip: job.totalTip,
      transportation: job.parking,
      employeePay: job.employeePay,
      employeePayIsManual: job.employeePayIsManual,
      payType: job.payType,
      hourlyRate: job.hourlyRate,
      billingType: job.billingType,
      billedHourlyRate: job.billedHourlyRate,
      billedEstimatedHours: job.billedEstimatedHours,
      billedActualHours: job.billedActualHours,
      hasCardOnFile: !!job.stripePaymentMethodId,

      notes: job.notes,
      cancellationReason: job.cancellationReason,
      photoCount: job._count.photos,
      bookingSource: job.bookingSource,
      pricingMode: job.pricingMode,
    };

    return { success: true, job: dto };
  } catch (error) {
    console.error("getJobSummary failed", error);
    return { success: false, error: "Could not load this booking" };
  }
}
