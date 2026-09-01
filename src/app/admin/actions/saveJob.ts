"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
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
import {
  addOnQuantity,
  computeJobMoney,
  isPricingMode,
  jobPayBasis,
  passThroughTotal,
  resolvePassThroughBilling,
  resolvePricingMode,
  type JobPricingMode,
} from "@/lib/job-money";
import {
  hourlyServiceAmount,
  isBillingType,
  roundBilledHours,
  type JobBillingType,
} from "@/lib/hourly-billing";
import { parsePropertyType, type PropertyType } from "@/lib/property-type";
import { HOLD_REASON, ON_HOLD_STATUS } from "@/lib/job-hold";
import { resolveJobAddressId } from "@/lib/client-address-store";
import { resolveJobClient } from "@/lib/client-capture";
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
import { addStoreDays, storeDateKey, storeWallClockToUtc } from "@/lib/timezone";
import { allocateJobNumber } from "@/lib/job-number";
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

    // ── Client capture (Stage 4.2, item 4) ────────────────────────────────────
    // This action used to read `clientId` and, when it was blank, store the
    // free-text name with `clientId: null` — there was no `db.client.create`
    // anywhere in this file. Every booking made through JobModal (Jobs page
    // "+ New job", the calendar create flow) therefore had no contact record,
    // and every customer email in the admin silently no-ops without one. The
    // dedupe-then-create lived only in admin/jobs/new/page.tsx's local action;
    // it is now shared (src/lib/client-capture.ts) and both forms call it.
    const rawClientId = (formData.get("clientId") as string) || null;
    let clientName = (formData.get("clientName") as string) || "";
    const clientEmail = ((formData.get("clientEmail") as string) || "").trim();
    const clientPhone = ((formData.get("clientPhone") as string) || "").trim();
    let clientDiscountPercent = 0;
    let clientFixedPrice: number | null = null;
    let clientFixedPriceRecurring = false;
    let clientFixedPriceAllowFreqDiscount = false;

    // ── Saved address (item 2) ────────────────────────────────────────────────
    // Before this stage saveJob had no address-book logic at all: the modal's
    // Location / Apt went onto the job and nowhere else, so an address typed
    // here was never offered again. That behaviour existed only in the
    // full-page form (admin/jobs/new/page.tsx); it is now shared.
    const locationInput = ((formData.get("location") as string) || "").trim();
    const aptInput = ((formData.get("aptNumber") as string) || "").trim();
    // Postal code (item 3). Part of the job's address snapshot, and pushed onto
    // the client's saved address below so entering it once teaches the book.
    const postalInput = ((formData.get("postalCode") as string) || "").trim();
    const pickedAddressId =
      ((formData.get("clientAddressId") as string) || "").trim() || null;

    // Create the customer profile for a brand-new name (deduped by email or
    // phone first). Restricted on the EDIT path to submissions that actually
    // carry contact details: re-saving one of the legacy jobs that has no
    // client must not mint an empty contact record as a side effect of an
    // unrelated edit. Supplying an email or a phone on such a job is the
    // deliberate act, and it retro-links the booking.
    const savingExistingJob = !!((formData.get("jobId") as string | null) || "");
    const clientId =
      savingExistingJob && !clientEmail && !clientPhone
        ? rawClientId
        : (
            await resolveJobClient({
              clientId: rawClientId,
              clientName,
              clientEmail,
              clientPhone,
              address: locationInput,
              aptNumber: aptInput,
              postalCode: postalInput,
            })
          ).clientId;

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

    let price = parseOptionalFloat(formData.get("price"));

    // Square footage (item 8). Stored on EVERY job as property information; it
    // only drives the price on square-foot-priced services (move in/out).
    const squareFootage = parseOptionalInt(formData.get("squareFootage"));
    const jobTypeRaw = (formData.get("jobType") as string) || null;

    // ── Property type (Stage 9 / PDF #11) ────────────────────────────────────
    //
    // Property INFORMATION, in the same family as `squareFootage` above. It is
    // NOT `jobTypeRaw`: that decides the service, the pricing rule and the
    // checklist triggers, and folding a building type into it would move all
    // three. Nothing below reads this — it prices nothing and pays nothing.
    //
    // Tri-state, the same discipline `billingType` uses just below: a form that
    // OWNS the control posts the key — blank included, which is an admin
    // deliberately clearing it — and a form that never rendered the control
    // posts nothing and must preserve what is stored rather than blanking it.
    const propertySubmitted = formData.has("propertyType");
    let propertyType: PropertyType | null = propertySubmitted
      ? parsePropertyType(formData.get("propertyType"))
      : null;

    // ── Checklist template pin (Stage 10 / PDF #10) ──────────────────────────
    //
    // "Auto" — the blank option, and every existing row — leaves resolution to
    // the shared precedence (address-scoped → client-scoped → service default).
    // A value PINS this job to one template and beats all three.
    //
    // Same tri-state as `propertyType` above and `billingType` below: a form
    // that owns the control posts the key (blank included, which is an admin
    // deliberately going back to Auto); a form that never rendered it posts
    // nothing and must preserve what is stored.
    const checklistSubmitted = formData.has("checklistTemplateId");
    let checklistTemplateId: string | null = checklistSubmitted
      ? ((formData.get("checklistTemplateId") as string) || "").trim() || null
      : null;

    // ── Customer-side hourly billing (Stage 8 / PDF #8) ──────────────────────
    //
    // Same tri-state discipline `payType` uses below, and for the same reason:
    // the jobs-list quick-edit modal does not render this control, and a form
    // that never showed a field must not reset it. A submission that OWNS the
    // control posts `billingType`; anything else preserves what is stored.
    //
    // These are the CUSTOMER's rate and hours. `hourlyRate` further down is the
    // CLEANER's, and the two are never read together (decision D6).
    const billingSubmitted = formData.has("billingType");
    let billingType: JobBillingType = "FLAT";
    let billedHourlyRate: number | null = null;
    let billedEstimatedHours: number | null = null;
    let billedActualHours: number | null = null;
    const existingBillingJobId = (formData.get("jobId") as string | null) || null;
    // ONE read serves all three preservation cases. Billing, property type and
    // the checklist pin carry independent tri-states, so any of them can be the
    // missing one; a second round-trip per field would be pure waste on the
    // common path where the job modal posts all three.
    const preservedFields =
      (!billingSubmitted || !propertySubmitted || !checklistSubmitted) &&
      existingBillingJobId
        ? await db.job.findUnique({
            where: { id: existingBillingJobId },
            select: {
              billingType: true,
              billedHourlyRate: true,
              billedEstimatedHours: true,
              billedActualHours: true,
              propertyType: true,
              checklistTemplateId: true,
            },
          })
        : null;
    if (!propertySubmitted) propertyType = preservedFields?.propertyType ?? null;

    // ── Saved address, resolved (items 2 + 3) ────────────────────────────────
    //
    // A picked id is honoured only if it belongs to this client AND still
    // describes what was typed — an admin who picks "Home" and then edits the
    // Location field would otherwise link the job to Home's door codes while
    // sending the cleaner somewhere else. Anything typed that isn't already in
    // the book is added to it.
    //
    // Resolved HERE, after the property fields, rather than up beside the other
    // address inputs: the address book learns the postal code AND the property
    // size from this save, and the size is only known once `propertyType`'s
    // tri-state has settled. Nothing between here and `jobData` reads
    // `clientAddressId`, so the move is order-of-work only.
    //
    // Everything below is BLANKS-ONLY inside `upsertClientAddress`: saving a job
    // with the bedrooms box empty can never erase what an admin recorded on the
    // customer's address, and a booking that says 2 can never overwrite a 3
    // somebody entered after actually going there.
    const clientAddressId = await resolveJobAddressId(clientId, {
      addressId: pickedAddressId,
      address: locationInput,
      aptNumber: aptInput || null,
      postalCode: postalInput || null,
      propertyType,
      bedCount: parseOptionalInt(formData.get("bedCount")),
      bathCount: parseOptionalInt(formData.get("bathCount")),
      halfBathCount: parseOptionalInt(formData.get("halfBathCount")),
      squareFootage,
    });
    if (!checklistSubmitted) {
      checklistTemplateId = preservedFields?.checklistTemplateId ?? null;
    }
    // A stale id from a form left open while the template was deleted would
    // otherwise surface as a raw foreign-key violation — a 500 on a save that
    // is otherwise perfectly valid. Falling back to Auto is the same outcome
    // the FK's ON DELETE SET NULL would have produced anyway.
    if (checklistSubmitted && checklistTemplateId) {
      const exists = await db.checklistTemplate.findUnique({
        where: { id: checklistTemplateId },
        select: { id: true },
      });
      if (!exists) checklistTemplateId = null;
    }
    if (billingSubmitted) {
      const raw = formData.get("billingType");
      billingType = isBillingType(raw) ? raw : "FLAT";
      if (billingType === "HOURLY") {
        billedHourlyRate = parseOptionalFloat(formData.get("billedHourlyRate"));
        const est = parseOptionalFloat(formData.get("billedEstimatedHours"));
        const act = parseOptionalFloat(formData.get("billedActualHours"));
        // Rounded on the way IN as well as at clock-out, so a typed 2.6 and a
        // measured 2.6 land on the same 2.5 and the two can never disagree by
        // a rounding rule (decision D7).
        billedEstimatedHours = est !== null && est > 0 ? roundBilledHours(est) : null;
        billedActualHours = act !== null && act > 0 ? roundBilledHours(act) : null;

        // Step 8.4. An hourly job with no rate cannot be priced at all, and an
        // hourly job with no hours would bill $0 — both are the admin having
        // filled in half a form, so say so rather than saving a broken job.
        if (billedHourlyRate === null || billedHourlyRate <= 0) {
          return { error: "Enter the customer's hourly rate for an hourly job." };
        }
        if (billedEstimatedHours === null && billedActualHours === null) {
          return { error: "Enter the estimated hours for an hourly job." };
        }
      }
      // FLAT: the three figures are cleared. Switching back to a flat price is
      // the admin saying the hourly terms no longer apply, and leaving a stale
      // rate behind would silently re-derive the price the next time anything
      // flipped the type back.
    } else if (existingBillingJobId) {
      billingType = (preservedFields?.billingType as JobBillingType) ?? "FLAT";
      billedHourlyRate = preservedFields?.billedHourlyRate ?? null;
      billedEstimatedHours = preservedFields?.billedEstimatedHours ?? null;
      billedActualHours = preservedFields?.billedActualHours ?? null;
    }

    // THE derived service line. Null on every flat job, which is why nothing
    // below changes for them.
    const hourlyBase = hourlyServiceAmount({
      billingType,
      billedHourlyRate,
      billedEstimatedHours,
      billedActualHours,
    });

    // Derive the price from square footage when the service is sqft-priced and
    // the admin left the price blank. An explicitly entered price always wins —
    // admins price jobs manually (courtesy jobs, negotiated totals), so this
    // must never overwrite a number a human typed.
    //
    // Step 8.8: skipped outright on an hourly job. Square-foot pricing is a
    // flat-rate residential assumption, and an hourly move-out would otherwise
    // have its price silently set from its floor area and then immediately
    // contradicted by `rate × hours` in the totals.
    if (
      billingType !== "HOURLY" &&
      price === null &&
      squareFootage !== null &&
      squareFootage > 0 &&
      isSqftJobType(jobTypeRaw)
    ) {
      const pricingCfg = await getServicePricingConfig();
      const derived = moveInOutBasePrice(squareFootage, pricingCfg);
      if (derived > 0) price = derived;
    }

    // Customer-specific fixed pricing ("Change Total"). When the client has a
    // fixed price and the admin left the price blank (or typed the fixed price
    // itself), the job charges the fixed total. An explicitly different price
    // wins and clears the flag.
    //
    // Step 8.8, second half: a customer-specific fixed price is a flat total by
    // definition, so it does not apply to a job the customer agreed to pay by
    // the hour. Without this guard an hourly job for a fixed-price client would
    // carry the "Fixed price" badge while being billed rate × hours.
    let usesFixedPrice = false;
    if (
      billingType !== "HOURLY" &&
      clientFixedPrice !== null &&
      clientFixedPrice > 0
    ) {
      if (price === null || price === clientFixedPrice) {
        price = clientFixedPrice;
        usesFixedPrice = true;
      }
    }

    const discountSubmitted = parseOptionalFloat(formData.get("discountAmount"));
    let discountAmount = discountSubmitted;
    // Why the discount was given (item 29). Free-form so an admin can type a
    // reason the presets don't cover.
    let discountReason = normalizeDiscountReason(formData.get("discountReason"));

    // Cleaner pay model for this job.
    //  • PERCENTAGE (default): tier/split math — auto-estimate the pool when the
    //    admin leaves employeePay blank (manual entry wins as an override).
    //  • FLAT: employeePay is the agreed fixed payout, exactly as entered.
    //  • HOURLY: hourlyRate drives it — employeePay = hourlyRate × scheduled
    //    hours × crew size when left blank, otherwise the entered override wins.
    //    That figure is an ESTIMATE only: from AWER round 4 (fix 5) the final
    //    clock-out replaces it with the crew's real clocked hours × the rate
    //    (snapshotHourlyEmployeePay), which is why the estimate now carries the
    //    crew multiplier — the two must be in the same unit.
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

    // GST/QST on the discounted subtotal from the admin-configured rates. The
    // job modal doesn't expose the cash-job toggle, so keep the existing job's
    // isCashJob when editing (new modal jobs are non-cash).
    //
    // `pricingMode`, `bookingSource` and `subtotalAmount` come from the SAME
    // lookup, and they are load-bearing: computeJobMoney decides from them
    // whether this job's add-ons are already priced into its service total.
    // Without them, an admin opening a WEB booking and pressing Save would be
    // treated as an admin job — adding its add-ons on top of a subtotal that
    // already contains them, and silently inflating a real customer's card.
    const editingJobId = (formData.get("jobId") as string | null) || null;
    let isCashJob = false;
    let existingBookingSource: string | null = null;
    let existingSubtotal: number | null = null;
    let existingPrice: number | null = null;
    let existingPricingMode: JobPricingMode | null = null;
    // D2 / D3 state carried out of the same lookup — see `payIsManual` and the
    // pass-through fold below. Both are about NOT clobbering something the admin
    // or the customer's card has already settled.
    let existingPayIsManual = false;
    let existingTotalAmount: number | null = null;
    let alreadySettled = false;
    // The two SETTLEMENT flags, carried out of the same lookup for the same
    // reason — see the note beside `jobData.paymentReceived` below.
    let existingPaymentReceived = false;
    let existingInvoiceSent = false;
    if (editingJobId) {
      const current = await db.job.findUnique({
        where: { id: editingJobId },
        select: {
          isCashJob: true,
          bookingSource: true,
          subtotalAmount: true,
          price: true,
          pricingMode: true,
          employeePayIsManual: true,
          totalAmount: true,
          paymentReceived: true,
          // Not used for pricing — carried so the edit path can PRESERVE the
          // two settlement flags no form posting to this action renders.
          invoiceSent: true,
          stripePaymentIntentId: true,
        },
      });
      isCashJob = current?.isCashJob ?? false;
      existingBookingSource = current?.bookingSource ?? null;
      existingSubtotal = current?.subtotalAmount ?? null;
      existingPrice = current?.price ?? null;
      existingPricingMode = isPricingMode(current?.pricingMode)
        ? current.pricingMode
        : null;
      existingPayIsManual = current?.employeePayIsManual ?? false;
      existingTotalAmount = current?.totalAmount ?? null;
      existingPaymentReceived = current?.paymentReceived ?? false;
      existingInvoiceSent = current?.invoiceSent ?? false;
      // "Settled" for D3 purposes: the customer's money has already moved.
      // `paymentReceived` is what chargeJob and toggleJobPaymentStatus flip;
      // the PaymentIntent covers a card charge that landed without the flag.
      alreadySettled =
        (current?.paymentReceived ?? false) ||
        current?.stripePaymentIntentId != null;
    }

    // ── Pricing mode (cleano_new_fixes.pdf fix 2) ────────────────────────────
    //
    // The mode used to be INFERRED from provenance, and — worse — re-inferred on
    // every save from whether the price field still matched the stored price
    // (`priceUnchanged`). An admin who retyped the price of a web booking or a
    // BookingKoala import silently flipped it to itemized, at which point its
    // add-ons started ADDING to a total that already contained them. It is now
    // an explicit, stored choice, resolved in this order:
    //
    //   1. "Recalculate from items" — the escape hatch. An explicit act, so it
    //      wins over the mode the form is carrying.
    //   2. The mode the form posted, when the form owns the control.
    //   3. The job's stored mode (edit paths whose form has no control, e.g. the
    //      jobs-list quick edit) — preserved, never reset.
    //   4. The historical fallback for a job that predates the column, and
    //      ITEMIZED for a brand-new admin job.
    const recalculateFromItems = formData.get("recalculateFromItems") === "on";
    const submittedPricingMode = formData.get("pricingMode");
    const pricingMode: JobPricingMode = recalculateFromItems
      ? "ITEMIZED"
      : isPricingMode(submittedPricingMode)
        ? submittedPricingMode
        : (existingPricingMode ??
          (editingJobId
            ? resolvePricingMode({ bookingSource: existingBookingSource })
            : "ITEMIZED"));

    // ── The hourly mirror (Stage 8, step 8.2) ────────────────────────────────
    //
    // `computeJobMoney` derives the service line from rate × hours on its own,
    // so this assignment does not change a single figure it returns. It exists
    // so the STORED `Job.price` says the same thing: about fifteen reporting
    // queries (analytics, exports, the dashboard, invoices) call
    // `activeSubtotal` through a `select` written before Stage 8 and therefore
    // fall back to that column. Keeping it equal to the derived amount is what
    // makes all of them print $240 instead of $0 without being rewritten.
    //
    // NOT applied under FINAL_PRICE: there `price` is the override the admin
    // typed, and overwriting it would both destroy the override and make
    // `priceRetyped` below fire on a save that changed nothing.
    if (hourlyBase !== null && pricingMode !== "FINAL_PRICE") {
      price = hourlyBase;
    }

    // Auto-apply the client's default discount when the admin hasn't entered
    // one. Treat null/empty as "not entered"; admin can pass "0" to opt out.
    // Fixed-price jobs skip it — the fixed price IS the agreed total.
    //
    // Moved below the hourly mirror (Stage 8): on an hourly job the price field
    // is blank, so computing a percentage of it up here gave a $0 discount on
    // every hourly booking for a client who has a standing discount.
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

    // Under FINAL_PRICE the ACTIVE service total is `subtotalAmount`, not
    // `price` — on a web booking `price` is the tax-INCLUSIVE booking total
    // while `subtotalAmount` is the pre-tax figure every money surface reads, so
    // the two are not interchangeable. The stored override is therefore
    // preserved byte-for-byte, which is what keeps "saving an existing booking
    // never changes its value" true rather than merely likely — until the admin
    // retypes the price, which is them authoring a new override total. That is
    // the ONLY thing this comparison decides now: it no longer touches the mode,
    // so a repriced FINAL_PRICE job stays FINAL_PRICE.
    const priceRetyped =
      existingPrice !== null &&
      price !== null &&
      Math.abs(existingPrice - price) >= 0.005;
    const overrideSubtotal =
      pricingMode === "FINAL_PRICE"
        ? priceRetyped || existingSubtotal === null || existingSubtotal <= 0
          ? price
          : existingSubtotal
        : null;

    // Per-job tax exemption (item 7) — the modal DOES expose this one, and it
    // applies to this job alone.
    const taxExempt = formData.get("taxExempt") === "on";
    /**
     * Fixed start time, or anywhere on the day? (Aug 31 list, item 11.)
     *
     * `isFlexible` already existed on the Job and was already READ in four
     * places — the available-jobs board, the job preview, Leads and Requests
     * all say "Flexible" — but nothing could ever SET it, so it was false on
     * every job in the system and those four displays were dead code. The
     * cleaner-facing consequence is in clockIn.ts: a flexible job cannot be
     * late, so it raises no penalty, no late email and no strike.
     */
    const isFlexible = formData.get("isFlexible") === "on";
    const taxRates = await getTaxRates();
    // ITEMIZED: add-ons and custom extra charges count (awerfixes item 10) — the
    // subtotal is `price + sum(unit x qty) - discount`, where it used to be
    // `price - discount` and a $25 custom charge billed $0.
    // FINAL_PRICE: the override total is read back unchanged, taxed as-is, and
    // the add-on rows persist as scope only (their unit prices are kept for
    // display; the MODE, not the price, is what decides they don't add).
    // HOURLY: the base service line is `billedHourlyRate × hours` — computed
    // inside the helper, not here, so the modal's live preview and this write
    // cannot disagree (step 8.2).
    const taxes = computeJobMoney(
      {
        pricingMode,
        bookingSource: existingBookingSource,
        price,
        discountAmount,
        subtotalAmount: overrideSubtotal,
        isCashJob,
        taxExempt,
        addOns,
        billingType,
        billedHourlyRate,
        billedEstimatedHours,
        billedActualHours,
      },
      taxRates
    );

    // ── Cleaner pay: the ESTIMATE and whether it is an ORDER ─────────────────
    //
    // Moved below `taxes` deliberately (Stage 4a.4). The estimate is a fraction
    // of the job's PAY BASIS — the active value the crew is actually cleaning
    // for — and the basis cannot be known until the pricing mode, the override
    // total and the add-on rows have all been resolved above. Computing it
    // earlier off `price` is exactly the defect fix 5 names: the $100 + $71 job
    // on page 5 of the PDF snapshotted its pay off $100.
    const payBasis = jobPayBasis({
      pricingMode,
      bookingSource: existingBookingSource,
      price,
      discountAmount,
      subtotalAmount: overrideSubtotal,
      addOns,
      // Step 8.6 — an hourly job's crew is paid a percentage of `rate × hours`,
      // the same figure the customer is billed. No branch is needed here; the
      // basis follows the money because both go through `computeJobMoney`.
      billingType,
      billedHourlyRate,
      billedEstimatedHours,
      billedActualHours,
    });

    let estimatedEmployeePay = manualEmployeePay;
    if (payType === "PERCENTAGE") {
      if (
        manualEmployeePay === null &&
        payBasis > 0 &&
        cleanerIds.length > 0
      ) {
        // Only the ASSIGNED CLEANERS form the payout pool. The acting admin used
        // to be prepended here, which inflated the team size by one and pushed
        // every solo job onto the 50% split-pool path (fix list item 3).
        const rateInputs = await getCleanerRateInputs(cleanerIds);
        const rateList = cleanerIds.map(
          (id) => rateInputs.get(id) ?? fallbackRateInput(id)
        );
        estimatedEmployeePay = computeJobPayout(payBasis, rateList).pool;
      }
    } else if (payType === "HOURLY") {
      if (manualEmployeePay === null && hourlyRate !== null && payHours !== null) {
        // TEAM TOTAL = rate × scheduled hours × CREW SIZE (AWER round 4, fix 5).
        //
        // `employeePay` is the team total that `computeJobPayShares` divides
        // between the crew, so the old `rate × hours` paid a two-person crew
        // half the rate each — and then clock-out paid them the full rate each,
        // because fix 5 settles an hourly job at "this cleaner's own clocked
        // hours × the rate". The estimate has to be in the same unit as the
        // settlement or the figure halves the moment the job is worked.
        //
        // `max(1, …)` because an unassigned job is estimated for one cleaner
        // rather than for nobody; assigning the second crew member re-saves and
        // the estimate follows.
        const crewSize = Math.max(1, cleanerIds.length);
        estimatedEmployeePay = +(hourlyRate * payHours * crewSize).toFixed(2);
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
    // total) and because the jobs list, invoices and metrics still read it.

    // Is that column an ORDER or a snapshot? (D2 / Stage 4c.2.)
    //
    // The form has to say so EXPLICITLY, and this is the whole subtlety of the
    // fix: JobModal prefills Employee pay from the stored column, so on every
    // re-save of every job `manualEmployeePay` is non-null. A naive "a value is
    // present → the admin meant it" rule would flag the entire database manual
    // on the next edit and freeze every job at a stale snapshot — the exact
    // failure mode the narrow backfill in 20260814010000 refuses to cause.
    //
    // So the form posts a tri-state and this reads it:
    //   "on"/"off"  the form owns the control (JobModal, jobs/new) — it knows
    //               whether the field was actually touched, and "Clear — use
    //               automatic calculation" posts "off".
    //   absent      a form with no control (the jobs-list quick edit). PRESERVE
    //               the stored flag; never reset it.
    // A brand-new job with a typed figure and no control is the admin authoring
    // an amount from scratch, so it counts as manual.
    const submittedPayIsManual = formData.get("employeePayIsManual");
    const employeePayIsManual =
      submittedPayIsManual === "on"
        ? true
        : submittedPayIsManual === "off"
          ? false
          : editingJobId
            ? existingPayIsManual
            : manualEmployeePay !== null;

    // ── D3: tips and parking ride along on the card ─────────────────────────
    //
    // They are paid OUT to the cleaners (4b.1), so they have to be collected IN
    // — otherwise the company funds them and profit drops, which is precisely
    // what the PDF forbids. `resolveAmountDue` already prefers `totalAmount`, so
    // folding them in here is the whole customer-side change; no billing code
    // moves. Untaxed on purpose: a tip is not a service, and parking is a
    // disbursement.
    //
    // On an already-charged job nothing is folded — see resolvePassThroughBilling.
    const passThrough = passThroughTotal({
      totalTip: parseOptionalFloat(formData.get("totalTip")),
      parking: parseOptionalFloat(formData.get("parking")),
    });
    const passThroughBilling = resolvePassThroughBilling({
      taxedTotal: taxes.totalAmount,
      passThrough,
      settled: alreadySettled,
      storedTotal: existingTotalAmount,
    });

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
      postalCode: postalInput || null,
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
      isFlexible,
      // Stamped on every save, so a job can never drift back to being priced by
      // inference (fix 2). `taxes.subtotalAmount` below is the ACTIVE service
      // total under whichever mode this is.
      pricingMode,
      subtotalAmount: taxes.subtotalAmount,
      gstAmount: taxes.gstAmount,
      qstAmount: taxes.qstAmount,
      // Service total WITH tax, plus the untaxed customer-funded pass-throughs
      // the card will actually take (D3). On a settled job this is byte-identical
      // to `taxes.totalAmount` plus whatever was already inside the stored total,
      // so adding a tip after payment never re-opens a balance.
      totalAmount: passThroughBilling.totalAmount,
      employeePay: estimatedEmployeePay,
      employeePayIsManual,
      payType,
      hourlyRate,
      // How the CUSTOMER is billed (Stage 8) — kept two lines below the two
      // fields that decide how the CLEANER is paid, and never confused with
      // them. `price` above is already the mirror of `billedHourlyRate ×
      // hours` when this is HOURLY and the job is not on an override.
      billingType,
      billedHourlyRate,
      billedEstimatedHours,
      billedActualHours,
      totalTip: parseOptionalFloat(formData.get("totalTip")),
      parking: parseOptionalFloat(formData.get("parking")),
      // NOT `formData.get(...) === "on"`. No form that posts to this action —
      // JobModal, the job detail editor, and both calendar editors — renders a
      // control for either flag, so that expression was a permanent `false`
      // that got spread straight into `db.job.update`: editing a description on
      // a PAID, invoiced job marked it unpaid and un-invoiced, silently and
      // with no audit row (no save path logs an EDIT).
      //
      // An unchecked checkbox and an absent control are identical in FormData,
      // so the value cannot answer "did the form submit this?" — the form's
      // SHAPE is the answer, and the shape is "not managed here". These are
      // payment state, not job setup; they are moved by chargeJob,
      // toggleJobPaymentStatus, sendInvoice and the invoice sync, and a job
      // editor must leave them exactly as it found them.
      //
      // This is the identical fix `/admin/jobs/new/page.tsx` already carries
      // (Stage 14.3.c). It never reached this file because §14.3's sweep only
      // ever read `src/app/admin/jobs/new/` — which is why the guard stayed
      // green while the bug was live on all four surfaces that post here.
      paymentReceived: editingJobId ? existingPaymentReceived : false,
      invoiceSent: editingJobId ? existingInvoiceSent : false,
      notes: (formData.get("notes") as string) || null,
      paymentType,
      discountAmount,
      // Parsed at the top of this action since discounts grew a reason (item
      // 29) — and, until now, never written. `jobData` carried the AMOUNT and
      // dropped the REASON on the floor, so "Courtesy" survived exactly as long
      // as the modal stayed open: every save stored the money and forgot why.
      // The children a few hundred lines below already read
      // `jobData.discountReason`, which was reading `undefined`.
      discountReason,
      squareFootage,
      bedCount: parseOptionalInt(formData.get("bedCount")),
      bathCount: parseOptionalInt(formData.get("bathCount")),
      halfBathCount: parseOptionalInt(formData.get("halfBathCount")),
      // Apartment/condo vs house (Stage 9). Sits with the other property
      // information, and carries across a recurring series through the
      // `...jobData` spread below — a series is one address, so every
      // occurrence is at the same kind of building by definition.
      propertyType,
      // Which checklist this job uses (Stage 10). Null = resolve automatically.
      // Rides the same `...jobData` spread into every recurring child, which is
      // the PDF's "checklist assignment should stay consistent when recurring
      // jobs are generated" — and is in SERIES_PROPAGATED_FIELDS so an edit to
      // one occurrence can be applied to the rest.
      checklistTemplateId,
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

      // Pricing-mode changes are logged (fix 2). This is the one edit that can
      // move every money surface on the job without any figure on the form
      // visibly changing — flipping an override job to itemized re-prices it
      // from its parts — so it must leave a trail with a name against it.
      // Best-effort: a failed log must never fail the save.
      if (existingPricingMode !== pricingMode) {
        const from = existingPricingMode ?? "not set";
        await db.jobLog
          .create({
            data: {
              jobId: editingJobId,
              userId: session.user.id,
              action: "UPDATED",
              description: recalculateFromItems
                ? `Pricing recalculated from items by ${session.user.name ?? "an admin"} — mode ${from} → ITEMIZED, service total $${taxes.subtotalAmount.toFixed(2)}`
                : `Pricing mode changed by ${session.user.name ?? "an admin"}: ${from} → ${pricingMode} (service total $${taxes.subtotalAmount.toFixed(2)})`,
            },
          })
          .catch(() => {});
      }

      // Manual-pay flips are logged for the same reason (D2 / Stage 4c.2):
      // turning the override on hands the crew a different amount than the tier
      // math would, and turning it off hands them the tier amount again —
      // neither of which is visible in any figure on the form. Best-effort.
      if (existingPayIsManual !== employeePayIsManual) {
        const who = session.user.name ?? "an admin";
        await db.jobLog
          .create({
            data: {
              jobId: editingJobId,
              userId: session.user.id,
              action: "UPDATED",
              description: employeePayIsManual
                ? `Cleaner pay set to MANUAL by ${who} — team total $${(estimatedEmployeePay ?? 0).toFixed(2)}, split evenly. Overrides the automatic tier calculation until cleared.`
                : `Manual cleaner pay CLEARED by ${who} — back to the automatic tier calculation on a pay basis of $${payBasis.toFixed(2)}.`,
            },
          })
          .catch(() => {});
      }

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
          // the STORE timezone, NOT server-local (UTC) — setHours on a UTC
          // server would put the cutoff at 5 pm UTC = ~1 pm Montréal. This was
          // 48 lines of hand-rolled Intl offset maths with the zone hardcoded;
          // @/lib/timezone does exactly the same thing (Stage 2 / Q9).
          const after5 = (() => {
            const now = new Date();
            // 17:00 store time on the day BEFORE the job, as an absolute instant.
            const cutoff = storeWallClockToUtc(
              storeDateKey(addStoreDays(existingJob.startTime, -1)),
              "17:00:00"
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
      // ── Round 4, fix 6 — an admin-created job is SCHEDULED, and says so ───
      //
      // Nothing here set a status, so every job an admin created fell to the
      // Prisma default `CREATED` — which the calendar renders as "On hold".
      // That is where the client's "what triggers On Hold?" question came from:
      // the answer was "creating a job", and it drowned the two holds that
      // actually mean something (a $0 import, an unpriced quote) in noise.
      //
      // Stamping it explicitly is what lets `CREATED` MEAN on hold from here
      // on. A job with a date is scheduled work; a job saved without one cannot
      // be scheduled, so it is a genuine hold and carries the reason why.
      //
      // Only on CREATE. The edit path a few hundred lines above must never
      // write a status it wasn't given — that is `statusRaw`'s job, and
      // re-stamping SCHEDULED there would drag a completed job backwards.
      const hasSchedule = Boolean(startDate && startTime);
      jobData.status = statusRaw ?? (hasSchedule ? "SCHEDULED" : ON_HOLD_STATUS);
      jobData.holdReason =
        jobData.status === ON_HOLD_STATUS && !hasSchedule ? HOLD_REASON.NO_DATE : null;

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

      // jobData is typed `any`, so the compiler cannot enforce this the way it
      // does at the other creation sites. Allocated per organization.
      jobData.jobNumber = await allocateJobNumber();
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
        // Children carry the same add-ons AND the same pricing mode as the
        // parent — a series is one agreement, so occurrence 4 must not be priced
        // by a different rule than occurrence 1. Under ITEMIZED every occurrence
        // bills the add-ons, not just the first. Under FINAL_PRICE each
        // occurrence carries the parent's agreed service total; the frequency
        // discount is still RECORDED on the child (reporting reads it) but not
        // subtracted, which is the FINAL_PRICE convention everywhere else.
        //
        // Stage 8: the billing TERMS carry to every occurrence (a series is one
        // agreement), so the children inherit `billingType`, the rate and the
        // ESTIMATE through the `...jobData` spread below. `billedActualHours`
        // is cleared per child — see the childData block — because occurrence 4
        // has not been worked yet, and inheriting visit 1's measured hours
        // would bill the customer for work that has not happened. Here that
        // means the child's hourly line is `rate × estimate`, which is exactly
        // what an unstarted occurrence is worth.
        const childTaxes = computeJobMoney(
          {
            pricingMode,
            bookingSource: null,
            price: basePrice,
            discountAmount: childDiscount,
            subtotalAmount:
              pricingMode === "FINAL_PRICE" ? taxes.subtotalAmount : null,
            isCashJob,
            taxExempt,
            addOns,
            billingType,
            billedHourlyRate,
            billedEstimatedHours,
            billedActualHours: null,
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
            // Every occurrence has a computed date by construction, so none of
            // them is ever the "created without a date" hold the parent might
            // be (round 4, fix 6). Spelled out rather than inherited: the
            // spread above would otherwise hand a whole series the parent's
            // hold and its reason, which would be wrong for all of them.
            status: "SCHEDULED",
            holdReason: null,
            endTime: durationMs != null ? new Date(cursor.getTime() + durationMs) : null,
            discountAmount: childDiscount,
            // Children carry ONLY the recurring frequency discount, so their
            // reason is that — regardless of why the first visit was discounted
            // (item 29, and see the referral/credit fix in commit d00415e).
            discountReason:
              recurringDiscount > 0 ? AUTO_REASON.RECURRING : jobData.discountReason,
            usesFixedPrice: childUsesFixedPrice,
            // A future occurrence has been worked for zero hours (Stage 8). The
            // spread above would otherwise hand every visit in the series the
            // first visit's measured hours.
            billedActualHours: null,
            // Stage 10 needs NOTHING here, and that is deliberate: the checklist
            // pin rides the `...jobData` spread above unchanged, which is
            // exactly the PDF's "checklist assignment should stay consistent
            // when recurring jobs are generated". Unlike `billedActualHours` it
            // is a term of the agreement, not a measurement of one visit, so
            // clearing it per child would be the bug rather than the fix.
            // Its price is the hourly line for the ESTIMATE, so the mirror on
            // the child agrees with its own `computeJobMoney` answer.
            ...(billingType === "HOURLY" && pricingMode !== "FINAL_PRICE"
              ? { price: childTaxes.basePrice }
              : {}),
            subtotalAmount: childTaxes.subtotalAmount,
            gstAmount: childTaxes.gstAmount,
            qstAmount: childTaxes.qstAmount,
            // A child inherits the parent's `totalTip`/`parking` through the
            // spread above, so it has to bill them too (D3) — otherwise every
            // occurrence after the first would pay the crew a pass-through the
            // customer was never charged for. A child is brand new, so nothing
            // is settled and the whole amount folds in.
            totalAmount: Math.round((childTaxes.totalAmount + passThrough) * 100) / 100,
            bookingSource: "admin-recurring",
            // `parentJobId`, NOT `parentJob: { connect }`. Prisma's create input
            // is a union: the CHECKED variant takes relation objects
            // (`parentJob`) and forbids scalar foreign keys, the UNCHECKED one
            // takes scalar FKs (`employeeId`, `clientId`, `clientAddressId` —
            // all of which arrive here through the `...jobData` spread) and
            // forbids relation objects. Mixing the two matched NEITHER variant,
            // so every child create threw an Unknown-argument validation error for employeeId, and
            // the outer catch turned it into "Failed to save job" — after the
            // parent had already been committed. That is why a recurring job
            // appeared to save while producing zero occurrences, on every
            // recurring job ever created. `cleaners` and `addOns` below are
            // safe as relations: implicit m2m and 1-n nested writes exist in
            // both variants; only an FK-backed to-one relation is variant-only.
            parentJobId: newJob.id,
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

          childData.jobNumber = await allocateJobNumber();
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
