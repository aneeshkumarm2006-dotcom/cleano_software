import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { getTaxRates } from "@/lib/tax.server";
import {
  computeJobMoney,
  isPricingMode,
  passThroughTotal,
  resolvePassThroughBilling,
  resolvePricingMode,
  sumAddOns,
  type JobPricingMode,
} from "@/lib/job-money";
import {
  SAVED_ADDRESS_ORDER,
  SAVED_ADDRESS_SELECT,
  resolveJobAddressId,
} from "@/lib/client-address-store";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import { resolveJobClient } from "@/lib/client-capture";
import { isSqftJobType, moveInOutBasePrice } from "@/lib/service-pricing";
import { tzWallClockToUtc, tzInputParts } from "@/lib/time";
import { syncJobAssignments } from "@/lib/job-assignments";
import { requireOwnerAdmin } from "@/lib/page-guards";
import { deleteJob as archiveJob } from "@/app/admin/actions/deleteJob";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { serviceOptions, resolveServiceValue } from "@/lib/service-catalog";
import { storeInputParts } from "@/lib/timezone";
import CleanerSelector from "./CleanerSelector";
import JobTypeSelector from "./JobTypeSelector";
import SubmitButton from "./SubmitButton";
import DeleteButton from "./DeleteButton";
import ClientNameField from "./ClientNameField";
import { ControlledDatePicker, ControlledTimePicker } from "./DateTimePicker";
import PaymentTypeSelect from "./PaymentTypeSelect";
import PayTypeFields from "./PayTypeFields";
import PricingModeField from "./PricingModeField";
import EmployeePayModeField from "./EmployeePayModeField";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PriceSummary from "./PriceSummary";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Optional manual per-cleaner payout (fix 4). Reads the `payFor_<id>` fields
// from the create/edit form and writes them onto JobAssignment.payAmount,
// which always wins over the automatic tier/flat calc for that cleaner (and
// is import-safe — imports never set it). A blank field clears any override.
//
// Module scope, and deliberately NOT a `"use server"` action. It used to be a
// nested inline action declared inside JobFormPage BELOW both of its call
// sites in saveJob, which threw `ReferenceError: applyManualPayouts is not
// defined` on every save with a cleaner assigned: normal function declarations
// hoist, but the `"use server"` transform rewrites an inline action into a
// separate generated binding that does not. It is an internal helper only ever
// called from inside other server actions in this file — never passed to a
// client component, never a `<form action={…}>` — so marking it `"use server"`
// also needlessly published it as a callable server endpoint.
async function applyManualPayouts(
  jobId: string,
  cleanerIds: string[],
  formData: FormData
) {
  for (const cleanerId of cleanerIds) {
    const raw = formData.get(`payFor_${cleanerId}`);
    const str = typeof raw === "string" ? raw.trim() : "";
    // Blank = "leave as-is", so editing a job here never wipes an override
    // set on the job detail page (which has its own Reset control). Only a
    // real number applies a manual amount.
    if (str === "") continue;
    const amount = Number(str);
    if (!Number.isFinite(amount) || amount < 0) continue;
    await db.jobAssignment
      .updateMany({ where: { jobId, cleanerId }, data: { payAmount: amount } })
      .catch(() => {});
  }
}

export default async function JobFormPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; duplicate?: string; fromQuote?: string }>;
}) {
  const {
    edit: jobId,
    duplicate: duplicateId,
    fromQuote: fromQuoteId,
  } = await searchParams;
  const isEditing = !!jobId;

  // This form edits price, cleaner pay and payment status, so it is ADMIN/OWNER
  // only. It previously had NO role check — the sole gate was
  // `existingJob.employeeId === session.user.id`, which worked only because
  // saveJob stamped every job's employeeId with the acting admin. That gate was
  // wrong in both directions: one admin could not edit another admin's job, and
  // once employeeId holds the LEAD CLEANER (as it should) an assigned cleaner
  // would have been able to open the admin job form. Guard on role instead.
  //
  // requireOwnerAdmin, not requireAdmin: the comment above has always claimed
  // ADMIN/OWNER, but requireAdmin admits all four staff roles. saveJob (the
  // action behind this form) is now OWNER/ADMIN, so without this an
  // OPS_MANAGER or FIELD_LEAD could fill the whole form and only discover the
  // refusal on submit.
  const session = await requireOwnerAdmin();

  // THE service list (item 20) — same source as the modal and the filters.
  const serviceCatalog = await getServiceCatalog();
  const serviceOptionList = serviceOptions(serviceCatalog);

  // Convert-to-job (10.4). `Convert to job` used to be a bare push to this
  // route with no query string, so every field the customer had already typed
  // was thrown away and the admin retyped a form they were looking at. The
  // quote id now travels; the form fills from it, and the hidden `fromQuoteId`
  // below flips the request to CONVERTED once the job actually saves — not on
  // arrival, so abandoning the form doesn't mark a quote won.
  const quoteSource = fromQuoteId
    ? await db.quoteRequest.findFirst({
        where: { id: fromQuoteId, deletedAt: null },
      })
    : null;
  const quotePrefill = quoteSource
    ? {
        clientName: quoteSource.name,
        clientEmail: quoteSource.email,
        clientPhone: quoteSource.phone ?? "",
        // The quote stores the canonical category key (10.1); map it onto an
        // option this catalog still offers, so a service retired since the
        // request came in leaves the picker blank instead of preselecting one
        // that no longer exists.
        jobType: resolveServiceValue(quoteSource.serviceType, serviceCatalog),
        location: quoteSource.address ?? "",
        bedCount: quoteSource.bedCount,
        bathCount: quoteSource.bathCount,
        squareFootage: quoteSource.squareFootage,
        // Preferred date is the customer's ask, not a commitment — it fills the
        // start date and the admin confirms or changes it before saving.
        startDate: quoteSource.preferredDate
          ? storeInputParts(quoteSource.preferredDate).date
          : "",
        notes: quoteSource.message ?? "",
      }
    : null;

  // Get existing job if editing
  let existingJob = null;
  if (isEditing) {
    existingJob = await db.job.findUnique({
      where: { id: jobId },
      // `addOns` feeds the pricing-mode control's hint: this page has no add-on
      // editor, but the rows it is about to re-price live here (fix 2).
      include: { cleaners: true, addOns: true },
    });

    if (!existingJob) {
      redirect("/admin/jobs");
    }
  }

  // Pre-fill from duplicate source (all fields except date/time, payment & clock data)
  let duplicateSource = null;
  if (duplicateId) {
    duplicateSource = await db.job.findUnique({
      where: { id: duplicateId },
      include: { cleaners: true },
    });
  }

  // Get all users to populate the cleaners dropdown
  const users = await db.user.findMany({
    where: { role: { not: "CLIENT" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      // Drives the service-category advisory in CleanerSelector (item 3).
      allowedServiceCategories: true,
      availabilities: {
        select: {
          day: true,
          startTime: true,
          endTime: true,
          isAvailable: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      },
    },
  });

  const usersForSelector = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    allowedServiceCategories: u.allowedServiceCategories,
    availability: u.availabilities.map((a) => ({
      day: a.day,
      startTime: a.startTime,
      endTime: a.endTime,
      isAvailable: a.isAvailable,
      effectiveFrom: a.effectiveFrom?.toISOString() ?? null,
      effectiveTo: a.effectiveTo?.toISOString() ?? null,
    })),
  }));

  // Get all clients for the client selector. Includes contact fields (so
  // selecting a client fills email/phone) and saved addresses (so the admin can
  // pick among a client's addresses or add a new one).
  const clientsRaw = await db.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      aptNumber: true,
      email: true,
      phone: true,
      discountPercent: true,
      fixedPrice: true,
      defaultPaymentMethodId: true,
      addresses: {
        orderBy: SAVED_ADDRESS_ORDER,
        select: SAVED_ADDRESS_SELECT,
      },
    },
  });
  const clients = clientsRaw.map((c) => ({
    ...c,
    addresses: c.addresses.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      aptNumber: a.aptNumber,
      city: a.city,
      postalCode: a.postalCode,
      accessNotes: a.accessNotes,
      isDefault: a.isDefault,
    })),
  }));

  async function saveJob(formData: FormData) {
    "use server";

    const session = await auth.api.getSession({
      headers: await headers(),
    });

    // Get selected cleaner IDs from form
    const cleanerIds = formData.getAll("cleaners") as string[];

    // Parse all form fields according to schema
    const startDate = formData.get("startDate") as string;
    const startTime = formData.get("startTime") as string;

    const validPaymentTypes = [
      "CASH",
      "CHEQUE",
      "E_TRANSFER",
      "CREDIT_CARD",
      "OTHER",
    ];
    const rawPaymentType = (formData.get("paymentType") as string) || "";
    const paymentType = validPaymentTypes.includes(rawPaymentType)
      ? rawPaymentType
      : null;
    const rawClientId = (formData.get("clientId") as string) || "";

    const clientName = ((formData.get("clientName") as string) || "").trim();
    const clientEmail = ((formData.get("clientEmail") as string) || "").trim();
    const clientPhone = ((formData.get("clientPhone") as string) || "").trim();
    const locationInput = ((formData.get("location") as string) || "").trim();
    const aptInput = ((formData.get("aptNumber") as string) || "").trim();
    // Postal code (item 3) — part of the job's address snapshot, and pushed
    // onto the client's saved address by the upsert below.
    const postalInput = ((formData.get("postalCode") as string) || "").trim();

    // New-customer capture: a name typed with no linked clientId creates a
    // Client profile so the job is tied to a real customer record (not just a
    // free-text name), deduped by email/phone first so we don't fork a customer
    // that already exists.
    //
    // This block used to be 30 lines of page-local logic, and it was the ONLY
    // copy — the shared `actions/saveJob` (JobModal, calendar, every Edit
    // button) had no `db.client.create` at all. It now lives in
    // src/lib/client-capture.ts and both save paths call it (Stage 4.2).
    //
    // On the EDIT path it only runs when contact details were actually
    // supplied, so re-saving one of the legacy jobs that has no client can't
    // mint an empty contact record as a side effect of an unrelated change —
    // the same rule the shared action applies. Repairing those deliberately is
    // the "Link to client" control on the job detail page.
    const savingExistingJob = !!((formData.get("jobId") as string | null) || "");
    const clientId =
      savingExistingJob && !clientEmail && !clientPhone
        ? rawClientId || null
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

    let price = formData.get("price")
      ? parseFloat(formData.get("price") as string)
      : null;

    // Square footage (item 8) — stored on every job; drives the price only on
    // square-foot-priced services, and never overwrites a price the admin typed.
    const squareFootage = formData.get("squareFootage")
      ? parseInt(formData.get("squareFootage") as string, 10)
      : null;
    const jobTypeRaw = (formData.get("jobType") as string) || null;
    if (
      price === null &&
      squareFootage !== null &&
      squareFootage > 0 &&
      isSqftJobType(jobTypeRaw)
    ) {
      const derived = moveInOutBasePrice(
        squareFootage,
        await getServicePricingConfig()
      );
      if (derived > 0) price = derived;
    }

    const savedClient = clientId
      ? await db.client.findUnique({
          where: { id: clientId },
          select: { discountPercent: true, fixedPrice: true },
        })
      : null;

    // Persist the job's address to the client's book so it's pickable next
    // time, and record which saved row this job is served at.
    //
    // This used to be two hand-rolled blocks here (a "Home" seed for a brand
    // new client, an "Other" create for a linked one). Both now go through the
    // shared upsert, which fixes the de-duplication this file got wrong: it
    // matched on an exact, case-sensitive `address` string and IGNORED
    // aptNumber, so "123 Main St " forked a duplicate row and a second unit at
    // the same street was silently dropped (item 2).
    //
    // An address picked from the dropdown is honoured only if it belongs to
    // this client AND still matches what's in the Location field, so editing
    // the address after picking one can't link the job to a different door.
    const pickedAddressId =
      ((formData.get("clientAddressId") as string) || "").trim() || null;
    const clientAddressId = await resolveJobAddressId(clientId, {
      addressId: pickedAddressId,
      address: locationInput,
      aptNumber: aptInput || null,
      postalCode: postalInput || null,
    });

    // Customer-specific fixed pricing ("Change Total"). When the client has a
    // fixed price and the admin left the price blank (or typed the fixed price
    // itself), the job charges the fixed total. An explicitly different price
    // wins and clears the flag.
    let usesFixedPrice = false;
    const clientFixedPrice = savedClient?.fixedPrice ?? null;
    if (clientFixedPrice !== null && clientFixedPrice > 0) {
      if (price === null || price === clientFixedPrice) {
        price = clientFixedPrice;
        usesFixedPrice = true;
      }
    }

    let discountAmount = formData.get("discountAmount")
      ? parseFloat(formData.get("discountAmount") as string)
      : null;

    // Auto-apply client default discount if admin didn't enter one.
    // Fixed-price jobs skip it — the fixed price IS the agreed total.
    if (
      (discountAmount === null || discountAmount === 0) &&
      !usesFixedPrice &&
      clientId &&
      price !== null &&
      price > 0
    ) {
      const pct = savedClient?.discountPercent ?? 0;
      if (pct > 0) {
        discountAmount = +(price * (pct / 100)).toFixed(2);
      }
    }

    // GST/QST on the discounted subtotal from the admin-configured rates.
    // Cash jobs are untaxed as a payment method; `taxExempt` is the explicit
    // per-job tax status an admin can set independently (item 7).
    //
    // This page has no add-on UI, but it IS an editor (?edit=<id>), so it must
    // still price a job's EXISTING add-ons the same way saveJob does. Taxing
    // `price - discount` here would rewrite subtotalAmount/totalAmount without
    // the add-ons while the JobAddOn rows survived — the job would display
    // charges it no longer bills, and resolveAmountDue would undercharge the
    // customer. See src/lib/job-money.ts.
    const isCashJob = formData.get("isCashJob") === "on";
    const taxExempt = formData.get("taxExempt") === "on";
    const editingIdForMoney = formData.get("jobId") as string | null;
    const moneyJob = editingIdForMoney
      ? await db.job.findUnique({
          where: { id: editingIdForMoney },
          select: {
            bookingSource: true,
            pricingMode: true,
            subtotalAmount: true,
            price: true,
            addOns: { select: { name: true, price: true, quantity: true } },
            // D2 / D3 — same two questions the shared saveJob asks: is the
            // stored Employee pay an order, and has the card already been taken?
            employeePayIsManual: true,
            totalAmount: true,
            paymentReceived: true,
            stripePaymentIntentId: true,
          },
        })
      : null;
    // Same explicit pricing mode as the shared saveJob (fix 2): the form's
    // selector wins, then "Recalculate from items", then the job's stored mode,
    // then the historical provenance fallback. Retyping the price no longer
    // flips the mode — it only re-authors a FINAL_PRICE job's override total.
    const existingMoneyMode = isPricingMode(moneyJob?.pricingMode)
      ? moneyJob.pricingMode
      : null;
    const recalculateFromItems = formData.get("recalculateFromItems") === "on";
    const submittedMode = formData.get("pricingMode");
    const pricingMode: JobPricingMode = recalculateFromItems
      ? "ITEMIZED"
      : isPricingMode(submittedMode)
        ? submittedMode
        : (existingMoneyMode ??
          (moneyJob
            ? resolvePricingMode({ bookingSource: moneyJob.bookingSource })
            : "ITEMIZED"));
    const moneyPriceRetyped =
      moneyJob?.price != null &&
      price !== null &&
      Math.abs(moneyJob.price - price) >= 0.005;
    const overrideSubtotal =
      pricingMode === "FINAL_PRICE"
        ? moneyPriceRetyped ||
          moneyJob?.subtotalAmount == null ||
          moneyJob.subtotalAmount <= 0
          ? price
          : moneyJob.subtotalAmount
        : null;
    const taxes = computeJobMoney(
      {
        pricingMode,
        bookingSource: moneyJob?.bookingSource ?? null,
        subtotalAmount: overrideSubtotal,
        price,
        discountAmount,
        isCashJob,
        taxExempt,
        addOns: moneyJob?.addOns ?? [],
      },
      await getTaxRates()
    );

    // Cleaner pay model: PERCENTAGE (tier/split), FLAT (fixed payout as
    // entered), HOURLY (hourlyRate × hours when employeePay is left blank).
    const validPayTypes = ["PERCENTAGE", "FLAT", "HOURLY"];
    const rawPayType = (formData.get("payType") as string) || "PERCENTAGE";
    const payType = validPayTypes.includes(rawPayType)
      ? rawPayType
      : "PERCENTAGE";
    const hourlyRate =
      payType === "HOURLY" && formData.get("hourlyRate")
        ? parseFloat(formData.get("hourlyRate") as string)
        : null;
    let employeePay = formData.get("employeePay")
      ? parseFloat(formData.get("employeePay") as string)
      : null;
    if (payType === "HOURLY" && employeePay === null && hourlyRate !== null) {
      const endDateVal = formData.get("endDate") as string;
      const endTimeVal = formData.get("endTime") as string;
      if (startDate && startTime && endDateVal && endTimeVal) {
        const ms =
          tzWallClockToUtc(endDateVal, endTimeVal).getTime() -
          tzWallClockToUtc(startDate, startTime).getTime();
        if (ms > 0) employeePay = +(hourlyRate * (ms / 3_600_000)).toFixed(2);
      }
    }

    // Is the Employee pay figure an ORDER or a snapshot? Same tri-state as the
    // shared saveJob (D2 / Stage 4c.2) — this form posts "on"/"off" from its own
    // control, and an absent field preserves the stored flag rather than
    // resetting it. See the long note in saveJob.ts for why "a value is present"
    // is NOT a safe rule.
    const submittedPayIsManual = formData.get("employeePayIsManual");
    const employeePayIsManual =
      submittedPayIsManual === "on"
        ? true
        : submittedPayIsManual === "off"
          ? false
          : moneyJob
            ? moneyJob.employeePayIsManual
            : employeePay !== null;

    // D3 — tips and parking are customer-funded pass-throughs, so they ride
    // along on the card when it has not been charged yet, and are flagged for
    // separate collection when it has. One helper, shared with saveJob.ts.
    const passThrough = passThroughTotal({
      totalTip: formData.get("totalTip")
        ? parseFloat(formData.get("totalTip") as string)
        : null,
      parking: formData.get("parking")
        ? parseFloat(formData.get("parking") as string)
        : null,
    });
    const passThroughBilling = resolvePassThroughBilling({
      taxedTotal: taxes.totalAmount,
      passThrough,
      settled:
        (moneyJob?.paymentReceived ?? false) ||
        moneyJob?.stripePaymentIntentId != null,
      storedTotal: moneyJob?.totalAmount ?? null,
    });

    const jobData: any = {
      // Lead cleaner, NOT the acting admin — see the matching comment in
      // saveJob.ts (fix list items 3 + 4).
      employeeId: cleanerIds[0] ?? null,
      taxExempt,
      clientName: clientName || (formData.get("clientName") as string),
      clientId,
      description: (formData.get("description") as string) || null,
      jobType: (formData.get("jobType") as string) || null,
      location: (formData.get("location") as string) || null,
      aptNumber: (formData.get("aptNumber") as string) || null,
      postalCode: postalInput || null,
      // Provenance only; the two fields above stay the snapshot (item 2).
      clientAddressId,
      // Wall-clock form inputs are America/Toronto; jobDate mirrors startTime's
      // instant (same convention as the BookingKoala importer).
      jobDate: startDate
        ? startTime
          ? tzWallClockToUtc(startDate, startTime)
          : tzWallClockToUtc(startDate)
        : null,
      startTime:
        startDate && startTime ? tzWallClockToUtc(startDate, startTime) : new Date(),
      price,
      usesFixedPrice,
      // Stamped on every save (fix 2) — see the shared saveJob action.
      pricingMode,
      subtotalAmount: taxes.subtotalAmount,
      gstAmount: taxes.gstAmount,
      qstAmount: taxes.qstAmount,
      // Service total with tax + the untaxed pass-throughs the card takes (D3).
      totalAmount: passThroughBilling.totalAmount,
      employeePay,
      employeePayIsManual,
      payType,
      hourlyRate,
      totalTip: formData.get("totalTip")
        ? parseFloat(formData.get("totalTip") as string)
        : null,
      parking: formData.get("parking")
        ? parseFloat(formData.get("parking") as string)
        : null,
      paymentReceived: formData.get("paymentReceived") === "on",
      invoiceSent: formData.get("invoiceSent") === "on",
      notes: (formData.get("notes") as string) || null,
      paymentType,
      discountAmount,
      squareFootage,
      bedCount: formData.get("bedCount")
        ? parseInt(formData.get("bedCount") as string, 10)
        : null,
      bathCount: formData.get("bathCount")
        ? parseInt(formData.get("bathCount") as string, 10)
        : null,
      halfBathCount: formData.get("halfBathCount")
        ? parseInt(formData.get("halfBathCount") as string, 10)
        : null,
      // payRateMultiplier is deliberately NOT written (AWER round 3, fix 1) —
      // the column is unread, and no form field ever fed it, so this only ever
      // reset saved jobs to 1.0. The rating premium lives on the cleaner now.
      isCashJob,
    };

    const editingJobId = formData.get("jobId") as string | null;

    if (editingJobId) {
      // UPDATE existing job.
      // This form leaves the existing team alone when no cleaners are submitted,
      // so the lead (`employeeId`) must be left alone too — otherwise editing an
      // unrelated field would strip the lead off an already-assigned job.
      const { employeeId: leadFromForm, ...jobDataWithoutLead } = jobData;
      await db.job.update({
        where: { id: editingJobId },
        data: {
          ...jobDataWithoutLead,
          ...(cleanerIds.length > 0 ? { employeeId: leadFromForm } : {}),
          cleaners:
            cleanerIds.length > 0
              ? {
                  set: cleanerIds.map((id) => ({ id })),
                }
              : undefined,
        },
      });

      // Keep per-cleaner JobAssignment rows in sync with the assigned team.
      if (cleanerIds.length > 0) {
        const sync = await syncJobAssignments(editingJobId, cleanerIds);
        if (!sync.ok) throw new Error(sync.error);
        await applyManualPayouts(editingJobId, cleanerIds, formData);
      }

      revalidatePath("/admin/jobs");
      redirect(`/admin/jobs/${editingJobId}`);
    } else {
      // CREATE new job
      // Only add cleaners if there are any selected
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }

      const created = await db.job.create({
        data: jobData,
      });

      // Creation / booking-source audit trail lives in Job Logs.
      await db.jobLog
        .create({
          data: {
            jobId: created.id,
            userId: session!.user.id,
            action: "CREATED",
            description: `Job created by ${session!.user.name ?? "an admin"} (admin)`,
          },
        })
        .catch(() => {});

      // Per-cleaner JobAssignment rows for the assigned team.
      //
      // Guarded here and NOT on the edit path above, because the two failures
      // are not the same failure. The job row already exists by this line, so a
      // throw would skip the redirect below and hand the admin a bare
      // server-exception page for a job that WAS created — they reasonably
      // conclude nothing saved, retry, and silently create a duplicate. Landing
      // on the jobs list with the team unassigned is strictly better: the job is
      // visible and the team can be fixed from the job detail page.
      //
      // On the EDIT path the job already existed, nothing is stranded by the
      // error, and the admin must be told their assignment change did not
      // stick — so `if (!sync.ok) throw new Error(sync.error)` stays as-is there.
      if (cleanerIds.length > 0) {
        try {
          const sync = await syncJobAssignments(created.id, cleanerIds);
          if (!sync.ok) throw new Error(sync.error);
          await applyManualPayouts(created.id, cleanerIds, formData);
        } catch (err) {
          console.error(
            `[admin/jobs/new] job ${created.id} was created, but assigning its team failed:`,
            err
          );
        }
      }

      // Convert-to-job (10.4): the request becomes CONVERTED only now, when a
      // job actually exists — opening the form and abandoning it must not move
      // the pipeline counter. `updateMany` so a quote deleted mid-edit is a
      // no-op rather than a thrown error that would strand a created job.
      const convertedQuoteId = ((formData.get("fromQuoteId") as string) || "").trim();
      if (convertedQuoteId) {
        await db.quoteRequest
          .updateMany({
            where: { id: convertedQuoteId },
            data: { status: "CONVERTED" },
          })
          .catch(() => {});
        await db.jobLog
          .create({
            data: {
              jobId: created.id,
              userId: session!.user.id,
              action: "UPDATED",
              description: `Converted from quote request ${convertedQuoteId}`,
            },
          })
          .catch(() => {});
        revalidatePath("/admin/quotes");
      }

      revalidatePath("/admin/jobs");
      redirect(convertedQuoteId ? "/admin/quotes" : "/admin/jobs");
    }
  }

  // ARCHIVE (soft delete) — see the same note in `admin/jobs/[id]/page.tsx`.
  // This was the second surviving copy of the `db.job.delete()` hard delete
  // that `actions/deleteJob.ts` was written to replace, and it destroyed the
  // row along with its logs, assignments, invites, checklists, photos and job
  // chat. Route through the audited action instead.
  async function archiveJobAction(formData: FormData) {
    "use server";

    const targetId = formData.get("jobId") as string;

    const result = await archiveJob(targetId);
    if ("error" in result && result.error) {
      throw new Error(result.error);
    }

    revalidatePath("/admin/jobs");
    redirect("/admin/jobs");
  }

  // Source for pre-filling: editing wins, then duplicate, then blank
  const prefill = existingJob ?? duplicateSource;
  const selectedCleanerIds = prefill?.cleaners?.map((c) => c.id) || [];

  return (
    // Item 6 / Q1. This page used to return `max-w-[68rem] mx-auto pb-24` with
    // NO padding at all, which produced both halves of the complaint: "Back to
    // Jobs" sat flush against the top of the content area ("a bit close to the
    // search bar"), and `max-w` does nothing until the viewport passes 68rem,
    // so from 320px to 1088px the form ran edge to edge with zero side gutters
    // ("the UI is just warped with the screen"). `p-8` is the container all 30
    // other admin pages use.
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div className="max-w-[68rem] mx-auto text-black pb-24">
      {/* Back button */}
      <Link
        href={quoteSource ? "/admin/quotes" : "/admin/jobs"}
        className="inline-flex items-center gap-1.5 text-sm mb-6 hover:opacity-70 transition-opacity"
        style={{ color: "var(--primary-60)" }}
      >
        <ArrowLeft size={14} />
        {quoteSource ? "Back to Quotes" : "Back to Jobs"}
      </Link>

      {/* Page header — the shared admin typography (`.admin-eyebrow` /
          `.admin-page-title`, used by ~37 admin files) instead of the
          hand-rolled inline clamp at weight 300. The two-tone "New *cleaning
          job.*" display style was retired elsewhere long ago. */}
      <header style={{ marginBottom: 36 }}>
        <p className="admin-eyebrow">{isEditing ? "Edit" : "Create"}</p>
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          {isEditing
            ? "Edit job"
            : duplicateId
            ? "Duplicate job"
            : quoteSource
            ? "New job from quote"
            : "New job"}
        </h1>
        <p style={{ marginTop: 10, fontSize: 15, color: "var(--primary-60)" }}>
          {quoteSource
            ? `Pre-filled from ${quoteSource.name}'s quote request. Check the details, then save — the request is marked Converted once the job is created.`
            : "Fill in the details below. You can update most fields later from the job detail page."}
        </p>
      </header>

      <form action={saveJob} className="space-y-5">
        {isEditing && existingJob && (
          <input type="hidden" name="jobId" value={existingJob.id} />
        )}
        {quoteSource && (
          <input type="hidden" name="fromQuoteId" value={quoteSource.id} />
        )}

        {/* Basic Information */}
        <SectionCard title="Basic information" subtitle="Who, what, where">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <FieldWrap
                label="Client name"
                hint="Search existing customers, or type a new name"
                required>
                <ClientNameField
                  clients={clients}
                  defaultName={prefill?.clientName || quotePrefill?.clientName || ""}
                  defaultClientId={prefill?.clientId || ""}
                  defaultEmail={quotePrefill?.clientEmail}
                  defaultPhone={quotePrefill?.clientPhone}
                />
              </FieldWrap>
            </div>

            <FieldWrap label="Job type">
              <JobTypeSelector
                initialValue={prefill?.jobType ?? quotePrefill?.jobType}
                options={serviceOptionList}
              />
            </FieldWrap>

            <FieldWrap label="Location" hint="Street address">
              <Input
                type="text"
                id="location"
                name="location"
                defaultValue={prefill?.location || quotePrefill?.location || ""}
                placeholder="123 rue Sainte-Catherine, Montréal"
              />
            </FieldWrap>

            {/* Item 3 — "in every single one, there should be an area to enter
                in your postal code". Saved on the job AND pushed onto the
                client's saved address. Transportation sits directly below it
                (stage 4.4: both belong NEAR THE ADDRESS — it is priced off how
                far the crew has to travel, which is what the address and postal
                code are telling you). */}
            <FieldWrap label="Postal code">
              <Input
                type="text"
                id="postalCode"
                name="postalCode"
                defaultValue={prefill?.postalCode || ""}
                placeholder="H2X 1Y6"
              />
            </FieldWrap>

            <FieldWrap label="Apartment / Unit #">
              <Input
                type="text"
                id="aptNumber"
                name="aptNumber"
                defaultValue={(prefill as any)?.aptNumber || ""}
                placeholder="e.g. Apt 4B, Unit 202"
              />
            </FieldWrap>

            {/* Item 3 / stage 4.4 — the same `parking` column, relabelled and
                moved up here from Pricing, where it sat between Total tip and
                Discount with the address three sections above it. Unchanged
                below the surface: still `name="parking"`, still id `parking`
                (which is how PriceSummary picks it up), still what the
                analytics Transportation tile sums
                (getLabourCostMetric: `acc.transportation += j.parking`).
                Manual entry: no zone table, no distance API (decided). */}
            <MoneyFieldWrap
              label="Transportation"
              id="parking"
              name="parking"
              defaultValue={prefill?.parking}
            />

            <div className="md:col-span-2">
              <FieldWrap label="Description">
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  defaultValue={prefill?.description || ""}
                  placeholder="Brief description of the job…"
                />
              </FieldWrap>
            </div>
          </div>
        </SectionCard>

        {/* Date & Time — always blank when duplicating */}
        <SectionCard title="Date & time" subtitle="Scheduled window">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <FieldWrap label="Start date">
              <ControlledDatePicker
                name="startDate"
                defaultValue={
                  isEditing && existingJob?.startTime
                    ? tzInputParts(existingJob.startTime).date
                    : quotePrefill?.startDate || ""
                }
                size="md"
              />
            </FieldWrap>

            <FieldWrap label="Start time">
              <ControlledTimePicker
                name="startTime"
                defaultValue={
                  isEditing && existingJob?.startTime
                    ? tzInputParts(existingJob.startTime).time
                    : ""
                }
                size="md"
              />
            </FieldWrap>

          </div>
        </SectionCard>

        {/* Team */}
        <SectionCard title="Team" subtitle="Assign cleaners to this job">
          <CleanerSelector
            users={usersForSelector}
            initialSelectedIds={selectedCleanerIds}
          />
        </SectionCard>

        {/* Pricing & Payment */}
        <SectionCard title="Pricing & payment" subtitle="Charges, costs, and payment method">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {/* Itemized vs final price override (fix 2). The mode decides what
                the Price field below MEANS: the base service line, or this
                job's whole agreed service total. */}
            <PricingModeField
              defaultValue={
                existingJob
                  ? resolvePricingMode(existingJob)
                  : duplicateSource
                    ? resolvePricingMode(duplicateSource)
                    : "ITEMIZED"
              }
              addOnTotal={sumAddOns(existingJob?.addOns)}
            />
            <MoneyFieldWrap label="Price" id="price" name="price" defaultValue={prefill?.price} />
            <MoneyFieldWrap label="Employee pay" id="employeePay" name="employeePay" defaultValue={prefill?.employeePay} />
            {/* Is that figure an order or an estimate? (fix 4 / D2.) The modal
                carries the same choice; both post `employeePayIsManual`. */}
            <EmployeePayModeField defaultValue={!!prefill?.employeePayIsManual} />

            <div className="md:col-span-2">
              <PayTypeFields
                defaultValue={(prefill as any)?.payType || "PERCENTAGE"}
                defaultHourlyRate={(prefill as any)?.hourlyRate ?? null}
              />
            </div>

            <MoneyFieldWrap label="Total tip" id="totalTip" name="totalTip" defaultValue={prefill?.totalTip} />
            {/* Transportation used to sit here. It moved to Basic information,
                immediately under Postal code (stage 4.4 — near the address).
                It still feeds the Pre-tax line in PriceSummary below. */}
            <MoneyFieldWrap label="Discount amount" id="discountAmount" name="discountAmount" defaultValue={prefill?.discountAmount} />

            <FieldWrap label="Payment type">
              <PaymentTypeSelect defaultValue={prefill?.paymentType || ""} />
            </FieldWrap>

            <div className="md:col-span-2">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="isCashJob"
                  defaultChecked={(prefill as any)?.isCashJob === true}
                  className="w-4 h-4 rounded accent-[#008C9C]"
                />
                <span style={{ fontSize: 14, color: "var(--ink)" }}>
                  Cash job <span style={{ color: "var(--primary-50)", fontWeight: 400 }}>— no Stripe charge, no tax, manual payment received</span>
                </span>
              </label>
            </div>

            <FieldWrap label="Bedrooms">
              <Input
                type="number"
                min="0"
                max="10"
                id="bedCount"
                name="bedCount"
                defaultValue={prefill?.bedCount ?? quotePrefill?.bedCount ?? ""}
                placeholder="0"
              />
            </FieldWrap>

            <FieldWrap label="Full bathrooms">
              <Input
                type="number"
                min="0"
                max="10"
                id="bathCount"
                name="bathCount"
                defaultValue={prefill?.bathCount ?? quotePrefill?.bathCount ?? ""}
                placeholder="0"
              />
            </FieldWrap>

            <FieldWrap label="Half bathrooms">
              <Input
                type="number"
                min="0"
                max="10"
                id="halfBathCount"
                name="halfBathCount"
                defaultValue={(prefill as any)?.halfBathCount ?? ""}
                placeholder="0"
              />
            </FieldWrap>

            {/* Item 8: square footage — stored on every job; drives the price
                only on square-foot-priced services (move in / move out). */}
            <FieldWrap
              label="Square footage"
              hint="Saved on the job. Used to price move-in / move-out cleans when Price is left blank.">
              <Input
                type="number"
                min="0"
                id="squareFootage"
                name="squareFootage"
                defaultValue={
                  (prefill as any)?.squareFootage ?? quotePrefill?.squareFootage ?? ""
                }
                placeholder="e.g. 1200"
              />
            </FieldWrap>
          </div>

          <PriceSummary />
        </SectionCard>

        {/* Notes */}
        <SectionCard title="Additional details" subtitle="Notes for the team">
          <FieldWrap label="Notes">
            <Textarea
              id="notes"
              name="notes"
              rows={4}
              defaultValue={prefill?.notes || quotePrefill?.notes || ""}
              placeholder="Pets, parking, door codes, sensitive surfaces, special requirements…"
            />
          </FieldWrap>
        </SectionCard>

        {/* Sticky footer. `md:left-[240px]` clears the fixed 240px sidebar,
            which is `z-50` and so painted over the bar's left end; the inner
            wrapper repeats the form's 68rem column so Cancel / Create sit
            under the form instead of drifting to the far edge of a wide
            window (Q1 §4). */}
        <div
          className="fixed bottom-0 left-0 right-0 md:left-[240px] z-40"
          style={{
            background: "rgba(250, 247, 242, 0.92)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid rgba(0,140,156,0.10)",
            padding: "14px 32px",
          }}
        >
          <div
            className="max-w-[68rem] mx-auto"
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 12,
            }}
          >
            {isEditing && existingJob && (
              <form action={archiveJobAction} style={{ marginRight: "auto" }}>
                <input type="hidden" name="jobId" value={existingJob.id} />
                <DeleteButton />
              </form>
            )}
            <Link
              href={
                isEditing
                  ? `/admin/jobs/${existingJob?.id}`
                  : duplicateId
                  ? `/admin/jobs/${duplicateId}`
                  : quoteSource
                  ? "/admin/quotes"
                  : "/admin/jobs"
              }>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <SubmitButton isEditing={isEditing} />
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}

// ─── Section card ───
function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  // `.dcard` is the system card (white / --primary-10 border / 16px radius),
  // rather than the inline #fff + rgba(0,140,156,…) this file re-declared. It
  // is a flex column with a 16px gap, so the head no longer carries its own
  // bottom margin.
  return (
    <section className="dcard">
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--primary-60)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

// ─── Field wrapper ───
function FieldWrap({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--primary-60)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        {label}
        {required && <span style={{ color: "var(--error)", marginLeft: 3 }}>*</span>}
        {hint && (
          <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, marginLeft: 6 }}>
            · {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

// ─── Money field wrapper ───
function MoneyFieldWrap({
  label,
  id,
  name,
  defaultValue,
}: {
  label: string;
  id: string;
  name: string;
  defaultValue?: number | null;
}) {
  return (
    <FieldWrap label={label}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none" style={{ color: "var(--primary-50)" }}>
          $
        </span>
        <Input
          type="number"
          step="0.01"
          min="0"
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          placeholder="0.00"
          className="pl-7"
        />
      </div>
    </FieldWrap>
  );
}
