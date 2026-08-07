"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";
import {
  sendAdminBookingModified,
  sendAdminBookingCanceled,
  sendCustomerBookingConfirmed,
  sendCustomerBookingModified,
  sendCustomerBookingCancellation,
  sendAdminTipReceived,
  sendCustomerFeesCharged,
  sendAdminUnassignedEvent,
  sendProviderNewTip,
  sendProviderBookingCanceled,
} from "@/lib/email";
import { isNotificationEnabled } from "@/lib/notifications";
import { smsBookingConfirmation, smsCancellation } from "@/lib/sms";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { computeJobPayout, fallbackRateInput } from "@/lib/pay-tiers";
import { getTaxRates } from "@/lib/tax.server";
import { addOnQuantity, computeJobMoney } from "@/lib/job-money";
import { resolveJobAddressId } from "@/lib/client-address-store";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import { isSqftJobType, moveInOutBasePrice } from "@/lib/service-pricing";
import { applyToJobSeries, seriesRootId, type SeriesUpdateResult } from "@/lib/job-series";
import { AUTO_REASON, normalizeDiscountReason } from "@/lib/discount-reasons";
import { createAssignmentInvites } from "@/lib/invites";
import { getSetting } from "@/lib/settings";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  resolveJobLead,
  syncJobAssignments,
  validateTraineePairing,
} from "@/lib/job-assignments";
import { fmtDate, fmtTime, tzWallClockToUtc } from "@/lib/time";
import {
  recurringDiscountPercent,
  recurrenceCount,
  nextOccurrence,
} from "@/lib/booking-pricing";

// Admin recurring cadences (awer_fixes.pdf item 9 — daily, weekly, biweekly,
// monthly). The pricing engine already understood MONTHLY; DAILY was added
// alongside it. QUARTERLY/TWICE_WEEKLY/HIGH_FREQUENCY remain booking-flow only.
const RECURRING_FREQUENCIES = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

const VALID_PAYMENT_TYPES = [
  "CASH",
  "CHEQUE",
  "E_TRANSFER",
  "CREDIT_CARD",
  "OTHER",
] as const;

const VALID_PAY_TYPES = ["PERCENTAGE", "FLAT", "HOURLY"] as const;
type PayType = (typeof VALID_PAY_TYPES)[number];

function parseOptionalFloat(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = parseFloat(value as string);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  if (value === null || value === "") return null;
  const n = parseInt(value as string, 10);
  return Number.isFinite(n) ? n : null;
}

export async function saveJob(formData: FormData) {
  // OWNER/ADMIN only. This used to check nothing but `if (!session)`, which is
  // authentication, not authorization — and a server action is an
  // independently callable POST endpoint, so the /admin layout guard never
  // covered it. Any signed-in account could reach it, including the CLIENT and
  // EMPLOYEE roles that the admin app bounces on sight. It writes job price,
  // discount, tax exemption, cleaner pay and payment status, so the tier has to
  // match the one on the money actions it sits beside (chargeJob,
  // togglePaymentReceived, permanentlyDeleteJobs).
  const actor = await requireOwnerAdmin();
  if (!actor.ok) {
    return { error: actor.error };
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    const cleanerIds = formData.getAll("cleaners") as string[];

    // Does THIS submission carry the team picker at all?
    //
    // `cleaners` is a repeated field: a job with no cleaners and a form that
    // never rendered the picker both arrive as zero entries, and the edit path
    // used to read both as "the admin cleared the team" and wipe the
    // assignment (new fix list item 2). Forms that own the picker post an
    // explicit `cleanersSubmitted` marker, so an empty list from them is a
    // real clear; any other caller leaves the existing team untouched.
    const teamSubmitted = formData.has("cleanersSubmitted");

    // Trainees must be paired with a Field Lead (item 2) — block a solo trainee.
    if (teamSubmitted) {
      const pairingError = await validateTraineePairing(cleanerIds);
      if (pairingError) return { error: pairingError };
    }

    const frequencyRaw = (formData.get("frequency") as string) || "ONE_TIME";
    const recurringFrequency = RECURRING_FREQUENCIES.includes(
      frequencyRaw as RecurringFrequency
    )
      ? (frequencyRaw as RecurringFrequency)
      : null;
    const addOnsRaw = formData.get("addOns") as string | null;
    let addOns: Array<{ name: string; price: number; quantity: number }> = [];
    if (addOnsRaw) {
      try {
        const parsed = JSON.parse(addOnsRaw);
        if (Array.isArray(parsed)) {
          addOns = parsed
            .filter((a) => a && typeof a.name === "string" && a.name.trim())
            .map((a) => ({
              name: String(a.name).trim(),
              price: Number(a.price) || 0,
              quantity: addOnQuantity(a),
            }));
        }
      } catch {
        // ignore bad JSON
      }
    }

    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;
    const endDate = formData.get("endDate") as string;
    const endTime = formData.get("endTime") as string;

    const paymentTypeRaw = (formData.get("paymentType") as string) || "";
    const paymentType = VALID_PAYMENT_TYPES.includes(paymentTypeRaw as any)
      ? (paymentTypeRaw as (typeof VALID_PAYMENT_TYPES)[number])
      : null;

    const clientId = (formData.get("clientId") as string) || null;
    let clientName = (formData.get("clientName") as string) || "";
    let clientDiscountPercent = 0;
    let clientFixedPrice: number | null = null;
    let clientFixedPriceRecurring = false;
    let clientFixedPriceAllowFreqDiscount = false;

    if (clientId) {
      const existing = await db.client.findUnique({ where: { id: clientId } });
      if (existing) {
        if (!clientName) clientName = existing.name;
        clientDiscountPercent = existing.discountPercent || 0;
        clientFixedPrice = existing.fixedPrice ?? null;
        clientFixedPriceRecurring = existing.fixedPriceRecurring;
        clientFixedPriceAllowFreqDiscount =
          existing.fixedPriceAllowFrequencyDiscount;
      }
    }

    // ── Saved address (item 2) ────────────────────────────────────────────────
    // Before this stage saveJob had no address-book logic at all: the modal's
    // Location / Apt went onto the job and nowhere else, so an address typed
    // here was never offered again. That behaviour existed only in the
    // full-page form (admin/jobs/new/page.tsx); it is now shared.
    const locationInput = ((formData.get("location") as string) || "").trim();
    const aptInput = ((formData.get("aptNumber") as string) || "").trim();
    const pickedAddressId =
      ((formData.get("clientAddressId") as string) || "").trim() || null;

    // A picked id is honoured only if it belongs to this client AND still
    // describes what was typed — an admin who picks "Home" and then edits the
    // Location field would otherwise link the job to Home's door codes while
    // sending the cleaner somewhere else. Anything typed that isn't already in
    // the book is added to it.
    const clientAddressId = await resolveJobAddressId(clientId, {
      addressId: pickedAddressId,
      address: locationInput,
      aptNumber: aptInput || null,
    });

    let price = parseOptionalFloat(formData.get("price"));

    // Square footage (item 8). Stored on EVERY job as property information; it
    // only drives the price on square-foot-priced services (move in/out).
    const squareFootage = parseOptionalInt(formData.get("squareFootage"));
    const jobTypeRaw = (formData.get("jobType") as string) || null;

    // Derive the price from square footage when the service is sqft-priced and
    // the admin left the price blank. An explicitly entered price always wins —
    // admins price jobs manually (courtesy jobs, negotiated totals), so this
    // must never overwrite a number a human typed.
    if (price === null && squareFootage !== null && squareFootage > 0 && isSqftJobType(jobTypeRaw)) {
      const pricingCfg = await getServicePricingConfig();
      const derived = moveInOutBasePrice(squareFootage, pricingCfg);
      if (derived > 0) price = derived;
    }

    // Customer-specific fixed pricing ("Change Total"). When the client has a
    // fixed price and the admin left the price blank (or typed the fixed price
    // itself), the job charges the fixed total. An explicitly different price
    // wins and clears the flag.
    let usesFixedPrice = false;
    if (clientFixedPrice !== null && clientFixedPrice > 0) {
      if (price === null || price === clientFixedPrice) {
        price = clientFixedPrice;
        usesFixedPrice = true;
      }
    }

    let discountAmount = parseOptionalFloat(formData.get("discountAmount"));
    // Why the discount was given (item 29). Free-form so an admin can type a
    // reason the presets don't cover.
    let discountReason = normalizeDiscountReason(formData.get("discountReason"));

    // Auto-apply client default discount when admin hasn't entered one.
    // Treat null/empty as "not entered"; admin can pass "0" to opt out.
    // Fixed-price jobs skip it — the fixed price IS the agreed total.
    if (
      discountAmount === null &&
      !usesFixedPrice &&
      clientDiscountPercent > 0 &&
      price !== null &&
      price > 0
    ) {
      discountAmount = +(price * (clientDiscountPercent / 100)).toFixed(2);
    }

    // A discount with no reason is what item 29 exists to stop. Where the
    // SYSTEM applied it we know why, so label it rather than leaving a blank
    // that reporting can't explain. An admin-entered reason always wins.
    if (!discountReason && (discountAmount ?? 0) > 0 && recurringFrequency) {
      discountReason = AUTO_REASON.RECURRING;
    }

    // Cleaner pay model for this job.
    //  • PERCENTAGE (default): tier/split math — auto-estimate the pool when the
    //    admin leaves employeePay blank (manual entry wins as an override).
    //  • FLAT: employeePay is the agreed fixed payout, exactly as entered.
    //  • HOURLY: hourlyRate drives it — employeePay = hourlyRate × hours when
    //    left blank, otherwise the entered override wins.
    const editingJobIdForPay = (formData.get("jobId") as string | null) || null;
    let payType: PayType = "PERCENTAGE";
    let hourlyRate: number | null = null;
    if (formData.has("payType")) {
      const payTypeRaw = (formData.get("payType") as string) || "PERCENTAGE";
      payType = VALID_PAY_TYPES.includes(payTypeRaw as PayType)
        ? (payTypeRaw as PayType)
        : "PERCENTAGE";
      hourlyRate =
        payType === "HOURLY" ? parseOptionalFloat(formData.get("hourlyRate")) : null;
    } else if (editingJobIdForPay) {
      // A form that doesn't expose the pay-type selector (e.g. the jobs-list
      // quick-edit modal) must PRESERVE the job's existing pay model, not reset
      // it to PERCENTAGE and null the hourly rate.
      const cur = await db.job.findUnique({
        where: { id: editingJobIdForPay },
        select: { payType: true, hourlyRate: true },
      });
      payType = (cur?.payType as PayType) ?? "PERCENTAGE";
      hourlyRate = cur?.hourlyRate ?? null;
    }

    // Job duration in hours, for HOURLY pay estimation.
    const payHours = (() => {
      if (startDate && startTime && endDate && endTime) {
        const s = tzWallClockToUtc(startDate, startTime).getTime();
        const e = tzWallClockToUtc(endDate, endTime).getTime();
        const ms = e - s;
        return ms > 0 ? ms / 3_600_000 : null;
      }
      return null;
    })();

    const manualEmployeePay = parseOptionalFloat(formData.get("employeePay"));
    let estimatedEmployeePay = manualEmployeePay;
    if (payType === "PERCENTAGE") {
      if (
        manualEmployeePay === null &&
        price !== null &&
        price > 0 &&
        cleanerIds.length > 0
      ) {
        // Only the ASSIGNED CLEANERS form the payout pool. The acting admin used
        // to be prepended here, which inflated the team size by one and pushed
        // every solo job onto the 50% split-pool path (fix list item 3).
        const rateInputs = await getCleanerRateInputs(cleanerIds);
        const rateList = cleanerIds.map(
          (id) => rateInputs.get(id) ?? fallbackRateInput(id)
        );
        estimatedEmployeePay = computeJobPayout(price, rateList).pool;
      }
    } else if (payType === "HOURLY") {
      if (manualEmployeePay === null && hourlyRate !== null && payHours !== null) {
        estimatedEmployeePay = +(hourlyRate * payHours).toFixed(2);
      }
    }
    // FLAT: estimatedEmployeePay stays as the manually entered payout.
    //
    // NOTE (AWER round 3, fix 1): for PERCENTAGE this is an ESTIMATE SNAPSHOT
    // taken at save time. It goes stale the moment a rating lands or Settings →
    // Pay Rate Multipliers is edited, so it is NOT the payout of record:
    // payroll, My Pay, the pay modal and the Job Details Financials tab all
    // recompute live via computeJobPayShares. It is kept because FLAT/HOURLY
    // genuinely need the column (computeJobPayShares reads it back as the team
    // total) and because the jobs list, invoices and metrics still read it. Job
    // Details shows a "Stored value — not used" row whenever it drifts.

    // GST/QST on the discounted subtotal from the admin-configured rates. The
    // job modal doesn't expose the cash-job toggle, so keep the existing job's
    // isCashJob when editing (new modal jobs are non-cash).
    //
    // `bookingSource` and `subtotalAmount` come from the SAME lookup, and they
    // are load-bearing: computeJobMoney decides from them whether this job's
    // add-ons are already priced into its stored subtotal. Without them, an
    // admin opening a WEB booking and pressing Save would be treated as an
    // admin job — adding its add-ons on top of a subtotal that already contains
    // them, and silently inflating a real customer's card.
    const editingJobId = (formData.get("jobId") as string | null) || null;
    let isCashJob = false;
    let existingBookingSource: string | null = null;
    let existingSubtotal: number | null = null;
    let existingPrice: number | null = null;
    if (editingJobId) {
      const current = await db.job.findUnique({
        where: { id: editingJobId },
        select: {
          isCashJob: true,
          bookingSource: true,
          subtotalAmount: true,
          price: true,
        },
      });
      isCashJob = current?.isCashJob ?? false;
      existingBookingSource = current?.bookingSource ?? null;
      existingSubtotal = current?.subtotalAmount ?? null;
      existingPrice = current?.price ?? null;
    }
    // A web / imported job's stored subtotal ALREADY contains its add-ons and is
    // ALREADY net of its discount, so it is preserved byte-for-byte — that is
    // what keeps "saving an existing booking never changes its value" true
    // rather than merely likely.
    //
    // Preserved only while the admin leaves the price alone. The moment they
    // retype it they are taking authorship of the number, so the job is priced
    // like any other admin job from then on; silently discarding a repriced web
    // booking would be the worse failure.
    const priceUnchanged =
      existingPrice !== null &&
      price !== null &&
      Math.abs(existingPrice - price) < 0.005;
    // Per-job tax exemption (item 7) — the modal DOES expose this one, and it
    // applies to this job alone.
    const taxExempt = formData.get("taxExempt") === "on";
    const taxRates = await getTaxRates();
    // Add-ons and custom extra charges finally count (awerfixes item 10): on an
    // admin job the subtotal is now `price + sum(unit x qty) - discount`, where
    // it used to be `price - discount` and a $25 custom charge billed $0.
    const taxes = computeJobMoney(
      {
        bookingSource: priceUnchanged ? existingBookingSource : null,
        price,
        discountAmount,
        subtotalAmount: priceUnchanged ? existingSubtotal : null,
        isCashJob,
        taxExempt,
        addOns,
      },
      taxRates
    );

    const jobData: any = {
      // The job's LEAD CLEANER — the same meaning bulkAssignCleaner, claimJob
      // and the cleaner app's my-jobs query give this column. This used to be
      // `session.user.id`, which stamped the ACTING ADMIN onto every job saved
      // from the modal: a 1-cleaner job was then paid as a 2-way split, and a
      // job with no cleaner paid the admin outright (fix list items 3 + 4).
      employeeId: cleanerIds[0] ?? null,
      clientName,
      clientId,
      description: (formData.get("description") as string) || null,
      jobType: (formData.get("jobType") as string) || null,
      location: (formData.get("location") as string) || null,
      aptNumber: (formData.get("aptNumber") as string) || null,
      // Provenance only — `location`/`aptNumber` above stay the snapshot this
      // job is actually served at (item 2).
      clientAddressId,
      // Wall-clock form inputs are America/Toronto; jobDate mirrors startTime's
      // instant (same convention as the BookingKoala importer) so tz-aware
      // date formatting never shows the previous day.
      jobDate: startDate
        ? startTime
          ? tzWallClockToUtc(startDate, startTime)
          : tzWallClockToUtc(startDate)
        : null,
      startTime:
        startDate && startTime ? tzWallClockToUtc(startDate, startTime) : new Date(),
      endTime: endDate && endTime ? tzWallClockToUtc(endDate, endTime) : null,
      price,
      usesFixedPrice,
      taxExempt,
      subtotalAmount: taxes.subtotalAmount,
      gstAmount: taxes.gstAmount,
      qstAmount: taxes.qstAmount,
      totalAmount: taxes.totalAmount,
      employeePay: estimatedEmployeePay,
      payType,
      hourlyRate,
      totalTip: parseOptionalFloat(formData.get("totalTip")),
      parking: parseOptionalFloat(formData.get("parking")),
      paymentReceived: formData.get("paymentReceived") === "on",
      invoiceSent: formData.get("invoiceSent") === "on",
      notes: (formData.get("notes") as string) || null,
      paymentType,
      discountAmount,
      squareFootage,
      bedCount: parseOptionalInt(formData.get("bedCount")),
      bathCount: parseOptionalInt(formData.get("bathCount")),
      halfBathCount: parseOptionalInt(formData.get("halfBathCount")),
      // payRateMultiplier is deliberately NOT written (AWER round 3, fix 1).
      // No form field ever existed, so this used to reset every saved job to
      // 1.0 — and the column is now unread anyway. Do not substitute the
      // cleaner's resolved multiplier here: that would recreate the stale
      // save-time snapshot this fix exists to remove.
    };

    const statusRaw = (formData.get("status") as string) || null;
    // Populated when the admin chose to apply this edit across the series.
    let seriesResult: SeriesUpdateResult | null = null;

    if (editingJobId) {
      // Snapshot the existing job so we can detect transitions:
      //  - status → CANCELLED (sends customer + admin cancellation)
      //  - 0 cleaners → ≥1 (sends customer "confirmed" email)
      //  - any other change (sends "modified" notifications)
      const existingJob = await db.job.findUnique({
        where: { id: editingJobId },
        select: {
          status: true,
          clientName: true,
          jobNumber: true,
          employeeId: true,
          parentJobId: true,
          startTime: true,
          location: true,
          jobType: true,
          totalTip: true,
          deletedAt: true,
          // Per-booking notification controls — gate job-scoped sends below.
          notifyClient: true,
          notifyProvider: true,
          client: { select: { email: true, name: true, phone: true } },
          cleaners: { select: { id: true, name: true, email: true } },
        },
      });

      // Editing an archived booking is not a thing. Without this the job modal
      // would happily rewrite the crew, price and schedule of a job that is out
      // of every list, count and report — and syncJobAssignments below would
      // mint JobAssignment rows for it. Restore it first if it is meant to be
      // live. (assignCleaners carries the same guard.)
      if (existingJob?.deletedAt) {
        return { error: "This booking is no longer active." };
      }

      // The team this job ends up with. When the submission didn't carry the
      // picker, that's the team it already had — the notification/lifecycle
      // checks below must reason about the real team, not an empty list.
      const existingCleanerIds = existingJob?.cleaners.map((c) => c.id) ?? [];
      const effectiveCleanerIds = teamSubmitted ? cleanerIds : existingCleanerIds;

      // `employeeId` is dropped from the generic field set: it holds the LEAD
      // CLEANER, and jobData derives it from the submitted picker. A save
      // without the picker must not null it out.
      const jobDataNoLead: Record<string, unknown> = { ...jobData };
      delete jobDataNoLead.employeeId;

      const updateData: any = {
        ...jobDataNoLead,
        addOns: {
          deleteMany: {},
          create: addOns.map((a) => ({
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
        },
      };

      // Only a submission that owns the team picker may rewrite the team.
      if (teamSubmitted) {
        // Keep an existing lead who is still on the team, so re-saving a job
        // never reshuffles the lead; otherwise take the first assigned cleaner.
        updateData.employeeId = resolveJobLead(existingJob?.employeeId, cleanerIds);
        updateData.cleaners = { set: cleanerIds.map((id) => ({ id })) };
      }

      if (statusRaw) {
        updateData.status = statusRaw;
      }

      await db.job.update({
        where: { id: editingJobId },
        data: updateData,
      });

      // Keep per-cleaner JobAssignment rows in sync with the assigned team.
      // A failure here is reported rather than swallowed — the admin must not
      // be told the save succeeded while the assignment silently reverts.
      // Skipped when the team wasn't submitted: syncing against an empty list
      // would delete the live assignment rows this save never touched.
      if (teamSubmitted) {
        const assignmentSync = await syncJobAssignments(editingJobId, cleanerIds);
        if (!assignmentSync.ok) {
          return { error: assignmentSync.error };
        }
      }

      // "Apply to the whole series" (item 9). Off by default: editing one
      // occurrence must never silently rewrite the rest of the series, which is
      // the behaviour the spec explicitly wants preserved. Dates are never
      // propagated, and completed/paid/cancelled occurrences are skipped so
      // financial history can't be rewritten.
      if (formData.get("applyToSeries") === "on" && existingJob) {
        const rootId = seriesRootId({
          id: editingJobId,
          parentJobId: existingJob.parentJobId ?? null,
        });
        seriesResult = await applyToJobSeries(
          editingJobId,
          rootId,
          jobDataNoLead,
          // undefined = don't touch the siblings' teams. Propagating an empty
          // list from a save that never carried the picker would unassign the
          // whole series (new fix list item 2).
          teamSubmitted ? cleanerIds : undefined
        );
      }

      // ── Booking lifecycle notifications ──────────────────────────
      const sessionUserName = session.user.name ?? "Admin";
      const lifecycleInfo = existingJob
        ? {
            jobId: editingJobId,
            jobNumber: existingJob.jobNumber,
            clientName: existingJob.clientName,
            startTime: existingJob.startTime.toISOString(),
            address: existingJob.location ?? "",
            serviceType: existingJob.jobType,
          }
        : null;

      // Case A — job just got CANCELLED
      if (
        statusRaw === "CANCELLED" &&
        existingJob &&
        existingJob.status !== "CANCELLED"
      ) {
        // System alert (legacy)
        await db.alert.create({
          data: {
            type: "CANCELLATION",
            severity: "WARNING",
            title: `Job cancelled: ${existingJob.clientName}`,
            message: `Job for ${existingJob.clientName} was cancelled (previously ${existingJob.status})`,
            relatedId: editingJobId,
            relatedType: "Job",
          },
        });

        // Admin email (after-5pm variant chosen inside the helper)
        if (lifecycleInfo) {
          sendAdminBookingCanceled({
            ...lifecycleInfo,
            canceledBy: sessionUserName,
          }).catch((e) => console.error("admin cancel email", e));

          // Customer email — gated by the per-booking notifyClient toggle.
          if (existingJob.notifyClient && existingJob.client?.email) {
            sendCustomerBookingCancellation({
              ...lifecycleInfo,
              to: existingJob.client.email,
            }).catch((e) => console.error("customer cancel email", e));
          }
          // Customer SMS (gated by Twilio config + catalog toggle + per-booking notifyClient).
          if (existingJob.notifyClient && existingJob.client?.phone) {
            smsCancellation({
              to: existingJob.client.phone,
              jobNumber: existingJob.jobNumber,
            }).catch((e) => console.error("customer cancel sms", e));
          }

          // Notify each assigned cleaner — email + app-push alert.
          // Gated by the per-booking notifyProvider toggle.
          for (const c of existingJob.notifyProvider ? existingJob.cleaners : []) {
            if (c.email) {
              sendProviderBookingCanceled({
                to: c.email,
                providerName: c.name,
                jobId: editingJobId,
                jobNumber: existingJob.jobNumber,
                clientName: existingJob.clientName,
                startTime: existingJob.startTime.toISOString(),
                address: existingJob.location ?? "",
                serviceType: existingJob.jobType,
              }).catch((e) => console.error("provider cancel email", e));
            }
            if (await isNotificationEnabled("PROVIDER", "prov.cancel.booking_canceled", "APP_PUSH")) {
              await db.alert.create({
                data: {
                  type: "CANCELLATION",
                  severity: "WARNING",
                  title: `Booking canceled — ${existingJob.clientName}`,
                  message: `Job #${existingJob.jobNumber} on ${fmtDate(existingJob.startTime)} was canceled.`,
                  recipientUserId: c.id,
                  relatedId: editingJobId,
                  relatedType: "Job",
                },
              }).catch(() => {});
            }
          }
        }
      } else if (existingJob && lifecycleInfo) {
        // Case B — non-cancel edit. Detect "cleaners just got assigned"
        // (customer "Booking confirmed") + generic "Booking modified".
        const previousCleanerIds = new Set(existingJob.cleaners.map((c) => c.id));
        const cleanersAdded = effectiveCleanerIds.filter(
          (id) => !previousCleanerIds.has(id)
        );
        const justGotFirstCleaner =
          existingJob.cleaners.length === 0 && effectiveCleanerIds.length > 0;

        // Customer "Booking confirmed" when the first cleaner is paired.
        // Gated by the per-booking notifyClient toggle.
        if (justGotFirstCleaner && existingJob.notifyClient && existingJob.client?.email) {
          const assignedCleaners = await db.user.findMany({
            where: { id: { in: effectiveCleanerIds } },
            select: { name: true },
          });
          sendCustomerBookingConfirmed({
            ...lifecycleInfo,
            to: existingJob.client.email,
            cleanerNames: assignedCleaners.map((c) => c.name),
          }).catch((e) => console.error("customer confirmed email", e));
          // Customer SMS (gated by Twilio config + catalog toggle).
          if (existingJob.client?.phone) {
            smsBookingConfirmation({
              to: existingJob.client.phone,
              jobNumber: existingJob.jobNumber,
              startTime: existingJob.startTime.toISOString(),
            }).catch((e) => console.error("customer confirmed sms", e));
          }
        }

        // Admin + customer "Booking modified" on any other edit.
        if (!justGotFirstCleaner) {
          sendAdminBookingModified({
            ...lifecycleInfo,
            changedBy: sessionUserName,
          }).catch((e) => console.error("admin modified email", e));
          // Customer "modified" email — gated by per-booking notifyClient.
          if (existingJob.notifyClient && existingJob.client?.email) {
            sendCustomerBookingModified({
              ...lifecycleInfo,
              to: existingJob.client.email,
            }).catch((e) => console.error("customer modified email", e));
          }
        }

        // Accept/decline invite for newly assigned cleaners.
        if (cleanersAdded.length > 0) {
          await createAssignmentInvites({
            jobId: editingJobId,
            cleanerIds: cleanersAdded,
          });
        }

        // Provider app-push for newly assigned cleaners ("New booking" for them).
        // Gated by the per-booking notifyProvider toggle.
        for (const cleanerId of existingJob.notifyProvider ? cleanersAdded : []) {
          if (await isNotificationEnabled("PROVIDER", "prov.booking.new", "APP_PUSH")) {
            await db.alert.create({
              data: {
                type: "GENERAL",
                severity: "INFO",
                title: `New booking — ${existingJob.clientName}`,
                message: `Job #${existingJob.jobNumber} on ${fmtDate(existingJob.startTime)} at ${fmtTime(existingJob.startTime)} has been assigned to you.`,
                recipientUserId: cleanerId,
                relatedId: editingJobId,
                relatedType: "Job",
              },
            }).catch(() => {});
          }
        }

        // Provider app-push for cleaners on a modified (already assigned) job.
        // Gated by the per-booking notifyProvider toggle.
        const stillAssigned = effectiveCleanerIds.filter((id) =>
          previousCleanerIds.has(id)
        );
        if (!justGotFirstCleaner && stillAssigned.length > 0 && existingJob.notifyProvider) {
          // Evaluate the "modified after 5 pm the day before the job" window in
          // America/Toronto (business tz), NOT server-local (UTC). setHours on a
          // UTC server would put the cutoff at 5 pm UTC = ~1 pm Toronto. Here we
          // build the 17:00-Toronto-the-day-before instant explicitly.
          const after5 = (() => {
            const TZ = "America/Toronto";
            const now = new Date();
            // DST-correct Toronto UTC offset (ms) at the job's time.
            const tzOffsetMs = (d: Date) => {
              const p = new Intl.DateTimeFormat("en-US", {
                timeZone: TZ,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })
                .formatToParts(d)
                .reduce<Record<string, string>>((a, x) => {
                  a[x.type] = x.value;
                  return a;
                }, {});
              const asUTC = Date.UTC(
                +p.year,
                +p.month - 1,
                +p.day,
                +p.hour % 24,
                +p.minute,
                +p.second
              );
              return asUTC - d.getTime();
            };
            const offset = tzOffsetMs(existingJob.startTime);
            // Toronto calendar date of the job.
            const jp = new Intl.DateTimeFormat("en-US", {
              timeZone: TZ,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            })
              .formatToParts(existingJob.startTime)
              .reduce<Record<string, string>>((a, x) => {
                a[x.type] = x.value;
                return a;
              }, {});
            // 17:00 Toronto on the day BEFORE the job, as an absolute instant.
            const cutoff = new Date(
              Date.UTC(+jp.year, +jp.month - 1, +jp.day - 1, 17, 0, 0) - offset
            );
            return now >= cutoff && now < existingJob.startTime;
          })();
          const provKey = after5 ? "prov.booking.modified_after_5pm" : "prov.booking.modified";
          for (const cleanerId of stillAssigned) {
            if (await isNotificationEnabled("PROVIDER", provKey, "APP_PUSH")) {
              await db.alert.create({
                data: {
                  type: "GENERAL",
                  severity: after5 ? "WARNING" : "INFO",
                  title: `Booking updated — ${existingJob.clientName}`,
                  message: `Job #${existingJob.jobNumber} on ${fmtDate(existingJob.startTime)} was modified${after5 ? " after 5 pm" : ""}.`,
                  recipientUserId: cleanerId,
                  relatedId: editingJobId,
                  relatedType: "Job",
                },
              }).catch(() => {});
            }
          }
        }
      }

      // Unassigned-folder events. The PDF treats "unassigned" as a booking
      // without any cleaners assigned yet (or fewer than required). Detect
      // transitions and fire the right catalog row.
      if (existingJob && lifecycleInfo) {
        const previouslyUnassigned = existingJob.cleaners.length === 0;
        const nowUnassigned = effectiveCleanerIds.length === 0;
        const openStatus =
          statusRaw !== "CANCELLED" &&
          statusRaw !== "COMPLETED" &&
          statusRaw !== "PAID";

        if (openStatus) {
          if (!previouslyUnassigned && nowUnassigned) {
            // Cleaners just got removed → "moved to unassigned"
            sendAdminUnassignedEvent({
              event: "moved",
              ...lifecycleInfo,
            }).catch((e) => console.error("admin unassigned moved", e));
          } else if (previouslyUnassigned && !nowUnassigned) {
            // Someone grabbed it
            sendAdminUnassignedEvent({
              event: "grabbed",
              ...lifecycleInfo,
            }).catch((e) => console.error("admin unassigned grabbed", e));
          } else if (previouslyUnassigned && nowUnassigned) {
            // Was unassigned, still unassigned, but the booking was edited
            sendAdminUnassignedEvent({
              event: "modified",
              ...lifecycleInfo,
            }).catch((e) => console.error("admin unassigned modified", e));
          }
        }
      }

      // Tip detection — admin gets `admin.fee.tip_received`, customer gets
      // `cust.fee.fees_charged` (only when totalTip increased).
      if (existingJob && lifecycleInfo) {
        const oldTip = existingJob.totalTip ?? 0;
        const newTip = jobData.totalTip ?? 0;
        if (newTip > oldTip && newTip - oldTip > 0.001) {
          const tipDelta = newTip - oldTip;
          sendAdminTipReceived({
            ...lifecycleInfo,
            tipAmount: tipDelta,
            cleanerNames: existingJob.cleaners.map((c) => c.name),
          }).catch((e) => console.error("admin tip-received email", e));
          // Customer fee email — gated by per-booking notifyClient.
          if (existingJob.notifyClient && existingJob.client?.email) {
            sendCustomerFeesCharged({
              ...lifecycleInfo,
              to: existingJob.client.email,
              clientName: existingJob.clientName,
              feeType: "tip",
              amount: tipDelta,
            }).catch((e) => console.error("customer tip-fee email", e));
          }
          // Tell every assigned cleaner about their tip — split evenly.
          // Gated by per-booking notifyProvider.
          if (existingJob.notifyProvider && existingJob.cleaners.length > 0) {
            const perCleaner = tipDelta / existingJob.cleaners.length;
            const cleanerUsers = await db.user.findMany({
              where: { id: { in: existingJob.cleaners.map((c) => c.id) } },
              select: { name: true, email: true },
            });
            for (const c of cleanerUsers) {
              if (!c.email) continue;
              sendProviderNewTip({
                to: c.email,
                providerName: c.name,
                jobId: editingJobId,
                jobNumber: existingJob.jobNumber,
                tipAmount: perCleaner,
                clientName: existingJob.clientName,
              }).catch((e) => console.error("provider tip email", e));
            }
          }
        }
      }

      if (jobData.startTime) {
        await invalidateCalendarDay(
          jobData.startTime.toISOString().slice(0, 10)
        );
      }
      revalidatePath("/admin/jobs");
      revalidatePath(`/admin/jobs/${editingJobId}`);
      revalidatePath("/admin/analytics");
      revalidatePath("/admin/calendar");
      return {
        success: true,
        // Reported back so the modal can say exactly what the series edit did,
        // including how many occurrences were protected from rewriting.
        seriesUpdated: seriesResult?.updated ?? 0,
        seriesSkipped: seriesResult?.skipped ?? 0,
      };
    } else {
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }
      if (addOns.length > 0) {
        jobData.addOns = {
          create: addOns.map((a) => ({
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
        };
      }

      const newJob = await db.job.create({ data: jobData });

      // Creation / booking-source audit trail lives in Job Logs (not the Team
      // card). Records that this job was admin-created and by whom.
      await db.jobLog
        .create({
          data: {
            jobId: newJob.id,
            userId: session.user.id,
            action: "CREATED",
            description: `Job created by ${session.user.name ?? "an admin"} (admin)`,
          },
        })
        .catch(() => {});

      // Per-cleaner JobAssignment rows for the assigned team. Reported, not
      // swallowed — see the edit path above (fix list item 4).
      if (cleanerIds.length > 0) {
        const sync = await syncJobAssignments(newJob.id, cleanerIds);
        if (!sync.ok) {
          return { error: sync.error, jobId: newJob.id };
        }
      }

      // Accept/decline invite for any cleaners assigned at creation.
      if (cleanerIds.length > 0) {
        await createAssignmentInvites({
          jobId: newJob.id,
          cleanerIds,
        });
      }

      // ── Recurring series ─────────────────────────────────────────────
      // Weekly/biweekly bookings auto-create the next few occurrences. The
      // first cleaning (this job) stays full price; subsequent cleanings get
      // the recurring discount (WEEKLY 12% / BIWEEKLY 8%) recorded on
      // discountAmount. Same assigned team carries across occurrences.
      if (recurringFrequency && jobData.startTime) {
        const weeklyHorizon = await getSetting(
          "scheduling.recurringWeeklyHorizon"
        );
        const occurrences = recurrenceCount(recurringFrequency, weeklyHorizon);
        const basePrice = jobData.price ?? 0;
        // Fixed-price clients: when the fixed total carries to recurring
        // bookings, child jobs keep price = fixedPrice and get NO frequency
        // discount unless the client explicitly allows stacking it on top.
        const childUsesFixedPrice = usesFixedPrice && clientFixedPriceRecurring;
        const skipFrequencyDiscount =
          childUsesFixedPrice && !clientFixedPriceAllowFreqDiscount;
        const discountPct = skipFrequencyDiscount
          ? 0
          : await recurringDiscountPercent(
              recurringFrequency,
              (formData.get("jobType") as string) || undefined
            );
        const recurringDiscount =
          basePrice > 0 && discountPct > 0
            ? Math.round(((basePrice * discountPct) / 100) * 100) / 100
            : 0;
        const childDiscount =
          recurringDiscount > 0
            ? +((jobData.discountAmount ?? 0) + recurringDiscount).toFixed(2)
            : jobData.discountAmount;
        // Child taxes are computed off the child's own discounted subtotal
        // (the fixed price when it carries over), not the parent's amounts.
        // The exemption is a property of the booking, so it carries to every
        // occurrence in the series (item 7). Each child can still be edited
        // individually afterwards.
        //
        // Children carry the same add-ons as the parent and are always
        // admin-authored (bookingSource "admin-recurring"), so they price
        // ADDITIVE — every occurrence bills the add-ons, not just the first.
        const childTaxes = computeJobMoney(
          {
            bookingSource: null,
            price: basePrice,
            discountAmount: childDiscount,
            isCashJob,
            taxExempt,
            addOns,
          },
          taxRates
        );

        // Preserve the job's duration across occurrences.
        const durationMs =
          jobData.endTime instanceof Date
            ? jobData.endTime.getTime() - jobData.startTime.getTime()
            : null;

        let cursor: Date = jobData.startTime;
        for (let i = 0; i < occurrences; i++) {
          cursor = nextOccurrence(cursor, recurringFrequency);
          const childData: any = {
            ...jobData,
            jobDate: cursor,
            startTime: cursor,
            endTime: durationMs != null ? new Date(cursor.getTime() + durationMs) : null,
            discountAmount: childDiscount,
            // Children carry ONLY the recurring frequency discount, so their
            // reason is that — regardless of why the first visit was discounted
            // (item 29, and see the referral/credit fix in commit d00415e).
            discountReason:
              recurringDiscount > 0 ? AUTO_REASON.RECURRING : jobData.discountReason,
            usesFixedPrice: childUsesFixedPrice,
            subtotalAmount: childTaxes.subtotalAmount,
            gstAmount: childTaxes.gstAmount,
            qstAmount: childTaxes.qstAmount,
            totalAmount: childTaxes.totalAmount,
            bookingSource: "admin-recurring",
            parentJob: { connect: { id: newJob.id } },
          };
          if (cleanerIds.length > 0) {
            childData.cleaners = { connect: cleanerIds.map((id) => ({ id })) };
          }
          if (addOns.length > 0) {
            childData.addOns = {
              create: addOns.map((a) => ({
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
            };
          }

          const child = await db.job.create({ data: childData });

          if (cleanerIds.length > 0) {
            await syncJobAssignments(child.id, cleanerIds);
            await createAssignmentInvites({ jobId: child.id, cleanerIds });
          }
          await invalidateCalendarDay(cursor.toISOString().slice(0, 10));
        }
      }

      // If created with no cleaners, this lands in the unassigned folder.
      if (cleanerIds.length === 0 && jobData.startTime) {
        sendAdminUnassignedEvent({
          event: "new",
          jobId: newJob.id,
          jobNumber: newJob.jobNumber,
          clientName: newJob.clientName,
          startTime: jobData.startTime.toISOString(),
        }).catch((e) => console.error("admin unassigned new", e));
      }

      if (jobData.startTime) {
        await invalidateCalendarDay(
          jobData.startTime.toISOString().slice(0, 10)
        );
      }
      revalidatePath("/admin/jobs");
      revalidatePath("/admin/analytics");
      return { success: true, jobId: newJob.id };
    }
  } catch (error) {
    console.error("Error saving job:", error);
    return { error: "Failed to save job. Please try again." };
  }
}
