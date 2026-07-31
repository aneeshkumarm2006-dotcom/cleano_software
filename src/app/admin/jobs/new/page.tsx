import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { getTaxRates, computeJobTaxes, isJobTaxExempt } from "@/lib/tax.server";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import { isSqftJobType, moveInOutBasePrice } from "@/lib/service-pricing";
import { tzWallClockToUtc, tzInputParts } from "@/lib/time";
import { syncJobAssignments } from "@/lib/job-assignments";
import { requireAdmin } from "@/lib/page-guards";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { serviceOptions } from "@/lib/service-catalog";
import CleanerSelector from "./CleanerSelector";
import JobTypeSelector from "./JobTypeSelector";
import SubmitButton from "./SubmitButton";
import DeleteButton from "./DeleteButton";
import ClientNameField from "./ClientNameField";
import { ControlledDatePicker, ControlledTimePicker } from "./DateTimePicker";
import PaymentTypeSelect from "./PaymentTypeSelect";
import PayTypeFields from "./PayTypeFields";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PriceSummary from "./PriceSummary";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function JobFormPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; duplicate?: string }>;
}) {
  const { edit: jobId, duplicate: duplicateId } = await searchParams;
  const isEditing = !!jobId;

  // This form edits price, cleaner pay and payment status, so it is ADMIN/OWNER
  // only. It previously had NO role check — the sole gate was
  // `existingJob.employeeId === session.user.id`, which worked only because
  // saveJob stamped every job's employeeId with the acting admin. That gate was
  // wrong in both directions: one admin could not edit another admin's job, and
  // once employeeId holds the LEAD CLEANER (as it should) an assigned cleaner
  // would have been able to open the admin job form. Guard on role instead.
  const session = await requireAdmin();

  // THE service list (item 20) — same source as the modal and the filters.
  const serviceOptionList = serviceOptions(await getServiceCatalog());

  // Get existing job if editing
  let existingJob = null;
  if (isEditing) {
    existingJob = await db.job.findUnique({
      where: { id: jobId },
      include: { cleaners: true },
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
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          label: true,
          address: true,
          aptNumber: true,
          isDefault: true,
        },
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
    let clientId: string | null = rawClientId || null;

    const clientName = ((formData.get("clientName") as string) || "").trim();
    const clientEmail = ((formData.get("clientEmail") as string) || "").trim();
    const clientPhone = ((formData.get("clientPhone") as string) || "").trim();
    const locationInput = ((formData.get("location") as string) || "").trim();
    const aptInput = ((formData.get("aptNumber") as string) || "").trim();

    // New-customer capture: a name typed with no linked clientId creates a
    // Client profile so the job is tied to a real customer record (not just a
    // free-text name). Dedupe against an existing client by email/phone first so
    // we don't fork a customer that already exists.
    if (!clientId && clientName) {
      let matched = null as { id: string } | null;
      if (clientEmail || clientPhone) {
        matched = await db.client.findFirst({
          where: {
            deletedAt: null,
            OR: [
              ...(clientEmail ? [{ email: clientEmail }] : []),
              ...(clientPhone ? [{ phone: clientPhone }] : []),
            ],
          },
          select: { id: true },
        });
      }
      if (matched) {
        clientId = matched.id;
      } else {
        const createdClient = await db.client.create({
          data: {
            name: clientName,
            email: clientEmail || null,
            phone: clientPhone || null,
            address: locationInput || null,
            aptNumber: aptInput || null,
          },
          select: { id: true },
        });
        clientId = createdClient.id;
        // Seed the client's first saved address from the job's address.
        if (locationInput) {
          await db.clientAddress
            .create({
              data: {
                clientId,
                label: "Home",
                address: locationInput,
                aptNumber: aptInput || null,
                isDefault: true,
              },
            })
            .catch(() => {});
        }
      }
    }

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

    // For an existing linked client, persist a newly-typed address to their
    // saved address book if it isn't there yet (so it's pickable next time).
    if (rawClientId && locationInput) {
      const already = await db.clientAddress.findFirst({
        where: { clientId: rawClientId, address: locationInput },
        select: { id: true },
      });
      if (!already) {
        const hasAny = await db.clientAddress.count({
          where: { clientId: rawClientId },
        });
        await db.clientAddress
          .create({
            data: {
              clientId: rawClientId,
              label: "Other",
              address: locationInput,
              aptNumber: aptInput || null,
              isDefault: hasAny === 0,
            },
          })
          .catch(() => {});
      }
    }

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
    const isCashJob = formData.get("isCashJob") === "on";
    const taxExempt = formData.get("taxExempt") === "on";
    const taxes = computeJobTaxes(
      (price ?? 0) - (discountAmount ?? 0),
      await getTaxRates(),
      isJobTaxExempt({ isCashJob, taxExempt })
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
      subtotalAmount: taxes.subtotalAmount,
      gstAmount: taxes.gstAmount,
      qstAmount: taxes.qstAmount,
      totalAmount: taxes.totalAmount,
      employeePay,
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
      payRateMultiplier: formData.get("payRateMultiplier")
        ? parseFloat(formData.get("payRateMultiplier") as string)
        : 1.0,
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
      if (cleanerIds.length > 0) {
        const sync = await syncJobAssignments(created.id, cleanerIds);
        if (!sync.ok) throw new Error(sync.error);
        await applyManualPayouts(created.id, cleanerIds, formData);
      }

      revalidatePath("/admin/jobs");
      redirect("/admin/jobs");
    }
  }

  // Optional manual per-cleaner payout (fix 4). Reads the `payFor_<id>` fields
  // from the create/edit form and writes them onto JobAssignment.payAmount,
  // which always wins over the automatic tier/flat calc for that cleaner (and
  // is import-safe — imports never set it). A blank field clears any override.
  async function applyManualPayouts(
    jobId: string,
    cleanerIds: string[],
    formData: FormData
  ) {
    "use server";
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

  async function deleteJob(formData: FormData) {
    "use server";

    const jobId = formData.get("jobId") as string;

    await db.job.delete({
      where: { id: jobId },
    });

    revalidatePath("/admin/jobs");
    redirect("/admin/jobs");
  }

  // Source for pre-filling: editing wins, then duplicate, then blank
  const prefill = existingJob ?? duplicateSource;
  const selectedCleanerIds = prefill?.cleaners?.map((c) => c.id) || [];

  return (
    <div className="max-w-[68rem] mx-auto text-black pb-24">
      {/* Back button */}
      <Link
        href="/admin/jobs"
        className="inline-flex items-center gap-1.5 text-sm mb-6 hover:opacity-70 transition-opacity"
        style={{ color: "var(--primary-60)" }}
      >
        <ArrowLeft size={14} />
        Back to Jobs
      </Link>

      {/* Page header */}
      <header style={{ marginBottom: 36 }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--primary-60)",
            marginBottom: 6,
          }}
        >
          {isEditing ? "Edit" : "Create"}
        </p>
        <h1
          style={{
            fontSize: "clamp(32px, 4vw, 46px)",
            fontWeight: 300,
            lineHeight: 1.1,
            color: "var(--ink)",
            margin: 0,
          }}
        >
          {isEditing ? (
            <>Edit <em style={{ fontStyle: "normal" }}>cleaning job.</em></>
          ) : duplicateId ? (
            <>Duplicate <em style={{ fontStyle: "normal" }}>cleaning job.</em></>
          ) : (
            <>New <em style={{ fontStyle: "normal" }}>cleaning job.</em></>
          )}
        </h1>
        <p style={{ marginTop: 10, fontSize: 15, color: "var(--primary-60)" }}>
          Fill in the details below. You can update most fields later from the job detail page.
        </p>
      </header>

      <form action={saveJob} className="space-y-5">
        {isEditing && existingJob && (
          <input type="hidden" name="jobId" value={existingJob.id} />
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
                  defaultName={prefill?.clientName || ""}
                  defaultClientId={prefill?.clientId || ""}
                />
              </FieldWrap>
            </div>

            <FieldWrap label="Job type">
              <JobTypeSelector
                initialValue={prefill?.jobType}
                options={serviceOptionList}
              />
            </FieldWrap>

            <FieldWrap label="Location" hint="Street address">
              <Input
                type="text"
                id="location"
                name="location"
                defaultValue={prefill?.location || ""}
                placeholder="123 rue Sainte-Catherine, Montréal"
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
                    : ""
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
            <MoneyFieldWrap label="Price" id="price" name="price" defaultValue={prefill?.price} />
            <MoneyFieldWrap label="Employee pay" id="employeePay" name="employeePay" defaultValue={prefill?.employeePay} />

            <div className="md:col-span-2">
              <PayTypeFields
                defaultValue={(prefill as any)?.payType || "PERCENTAGE"}
                defaultHourlyRate={(prefill as any)?.hourlyRate ?? null}
              />
            </div>

            <MoneyFieldWrap label="Total tip" id="totalTip" name="totalTip" defaultValue={prefill?.totalTip} />
            <MoneyFieldWrap label="Parking" id="parking" name="parking" defaultValue={prefill?.parking} />
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
                defaultValue={prefill?.bedCount ?? ""}
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
                defaultValue={prefill?.bathCount ?? ""}
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
                defaultValue={(prefill as any)?.squareFootage ?? ""}
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
              defaultValue={prefill?.notes || ""}
              placeholder="Pets, parking, door codes, sensitive surfaces, special requirements…"
            />
          </FieldWrap>
        </SectionCard>

        {/* Sticky footer */}
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(250, 247, 242, 0.92)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid rgba(0,140,156,0.10)",
            padding: "14px 32px",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 12,
            zIndex: 40,
          }}
        >
          {isEditing && existingJob && (
            <form action={deleteJob} style={{ marginRight: "auto" }}>
              <input type="hidden" name="jobId" value={existingJob.id} />
              <DeleteButton />
            </form>
          )}
          <Link href={isEditing ? `/admin/jobs/${existingJob?.id}` : duplicateId ? `/admin/jobs/${duplicateId}` : "/admin/jobs"}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <SubmitButton isEditing={isEditing} />
        </div>
      </form>
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
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid rgba(0,140,156,0.08)",
        borderRadius: 16,
        padding: "24px 28px",
        boxShadow: "0 1px 6px rgba(0,140,156,0.05)",
      }}
    >
      <div style={{ marginBottom: 20 }}>
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
