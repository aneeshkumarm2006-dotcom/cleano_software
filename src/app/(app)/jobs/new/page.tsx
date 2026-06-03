import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import CleanerSelector from "./CleanerSelector";
import JobTypeSelector from "./JobTypeSelector";
import SubmitButton from "./SubmitButton";
import DeleteButton from "./DeleteButton";
import ClientLinkSelector from "./ClientLinkSelector";
import { ControlledDatePicker, ControlledTimePicker } from "./DateTimePicker";
import PaymentTypeSelect from "./PaymentTypeSelect";
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
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit: jobId } = await searchParams;
  const isEditing = !!jobId;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Get existing job if editing
  let existingJob = null;
  if (isEditing) {
    existingJob = await db.job.findUnique({
      where: { id: jobId },
      include: {
        cleaners: true,
      },
    });

    if (!existingJob || existingJob.employeeId !== session.user.id) {
      redirect("/jobs");
    }
  }

  // Get all users to populate the cleaners dropdown
  const users = await db.user.findMany({
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

  // Get all clients for the client selector
  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      email: true,
      phone: true,
      discountPercent: true,
      defaultPaymentMethodId: true,
    },
  });

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
    const endDate = formData.get("endDate") as string;
    const endTime = formData.get("endTime") as string;

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
    const clientId = rawClientId || null;

    const price = formData.get("price")
      ? parseFloat(formData.get("price") as string)
      : null;

    let discountAmount = formData.get("discountAmount")
      ? parseFloat(formData.get("discountAmount") as string)
      : null;

    // Auto-apply client default discount if admin didn't enter one
    if (
      (discountAmount === null || discountAmount === 0) &&
      clientId &&
      price !== null &&
      price > 0
    ) {
      const c = await db.client.findUnique({
        where: { id: clientId },
        select: { discountPercent: true },
      });
      const pct = c?.discountPercent ?? 0;
      if (pct > 0) {
        discountAmount = +(price * (pct / 100)).toFixed(2);
      }
    }

    const jobData: any = {
      employeeId: session!.user.id,
      clientName: formData.get("clientName") as string,
      clientId,
      description: (formData.get("description") as string) || null,
      jobType: (formData.get("jobType") as string) || null,
      location: (formData.get("location") as string) || null,
      jobDate: startDate ? new Date(startDate) : null,
      startTime:
        startDate && startTime
          ? new Date(`${startDate}T${startTime}`)
          : new Date(),
      endTime: endDate && endTime ? new Date(`${endDate}T${endTime}`) : null,
      price,
      employeePay: formData.get("employeePay")
        ? parseFloat(formData.get("employeePay") as string)
        : null,
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
      bedCount: formData.get("bedCount")
        ? parseInt(formData.get("bedCount") as string, 10)
        : null,
      bathCount: formData.get("bathCount")
        ? parseInt(formData.get("bathCount") as string, 10)
        : null,
      payRateMultiplier: formData.get("payRateMultiplier")
        ? parseFloat(formData.get("payRateMultiplier") as string)
        : 1.0,
    };

    const editingJobId = formData.get("jobId") as string | null;

    if (editingJobId) {
      // UPDATE existing job
      await db.job.update({
        where: { id: editingJobId },
        data: {
          ...jobData,
          cleaners:
            cleanerIds.length > 0
              ? {
                  set: cleanerIds.map((id) => ({ id })),
                }
              : undefined,
        },
      });

      revalidatePath("/jobs");
      redirect(`/jobs/${editingJobId}`);
    } else {
      // CREATE new job
      // Only add cleaners if there are any selected
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }

      await db.job.create({
        data: jobData,
      });

      revalidatePath("/jobs");
      redirect("/jobs");
    }
  }

  async function deleteJob(formData: FormData) {
    "use server";

    const jobId = formData.get("jobId") as string;

    await db.job.delete({
      where: { id: jobId },
    });

    revalidatePath("/jobs");
    redirect("/jobs");
  }

  // Get selected cleaner IDs for editing
  const selectedCleanerIds = existingJob?.cleaners.map((c) => c.id) || [];

  return (
    <div className="max-w-[68rem] mx-auto text-black pb-24">
      {/* Back button */}
      <Link
        href="/jobs"
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
            <>Edit <em style={{ fontStyle: "italic" }}>cleaning job.</em></>
          ) : (
            <>New <em style={{ fontStyle: "italic" }}>cleaning job.</em></>
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
            <FieldWrap label="Link client" hint="Pulls in saved name + address">
              <ClientLinkSelector
                clients={clients}
                defaultValue={existingJob?.clientId || ""}
              />
            </FieldWrap>

            <FieldWrap label="Client name" required>
              <Input
                type="text"
                id="clientName"
                name="clientName"
                required
                defaultValue={existingJob?.clientName || ""}
                placeholder="e.g. Alexis Juarez"
              />
            </FieldWrap>

            <FieldWrap label="Job type">
              <JobTypeSelector initialValue={existingJob?.jobType} />
            </FieldWrap>

            <FieldWrap label="Location" hint="Address or general area">
              <Input
                type="text"
                id="location"
                name="location"
                defaultValue={existingJob?.location || ""}
                placeholder="123 rue Sainte-Catherine, Montréal"
              />
            </FieldWrap>

            <div className="md:col-span-2">
              <FieldWrap label="Description">
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  defaultValue={existingJob?.description || ""}
                  placeholder="Brief description of the job…"
                />
              </FieldWrap>
            </div>
          </div>
        </SectionCard>

        {/* Date & Time */}
        <SectionCard title="Date & time" subtitle="Scheduled window">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <FieldWrap label="Start date">
              <ControlledDatePicker
                name="startDate"
                defaultValue={
                  existingJob?.startTime
                    ? new Date(existingJob.startTime).toISOString().split("T")[0]
                    : ""
                }
                size="md"
              />
            </FieldWrap>

            <FieldWrap label="Start time">
              <ControlledTimePicker
                name="startTime"
                defaultValue={
                  existingJob?.startTime
                    ? new Date(existingJob.startTime).toISOString().split("T")[1].slice(0, 5)
                    : ""
                }
                size="md"
              />
            </FieldWrap>

            <FieldWrap label="End date">
              <ControlledDatePicker
                name="endDate"
                defaultValue={
                  existingJob?.endTime
                    ? new Date(existingJob.endTime).toISOString().split("T")[0]
                    : ""
                }
                size="md"
              />
            </FieldWrap>

            <FieldWrap label="End time">
              <ControlledTimePicker
                name="endTime"
                defaultValue={
                  existingJob?.endTime
                    ? new Date(existingJob.endTime).toISOString().split("T")[1].slice(0, 5)
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
            <MoneyFieldWrap label="Price" id="price" name="price" defaultValue={existingJob?.price} />
            <MoneyFieldWrap label="Employee pay" id="employeePay" name="employeePay" defaultValue={existingJob?.employeePay} />
            <MoneyFieldWrap label="Total tip" id="totalTip" name="totalTip" defaultValue={existingJob?.totalTip} />
            <MoneyFieldWrap label="Parking" id="parking" name="parking" defaultValue={existingJob?.parking} />
            <MoneyFieldWrap label="Discount amount" id="discountAmount" name="discountAmount" defaultValue={existingJob?.discountAmount} />

            <FieldWrap label="Payment type">
              <PaymentTypeSelect defaultValue={existingJob?.paymentType || ""} />
            </FieldWrap>

            <FieldWrap label="Bed count">
              <Input
                type="number"
                min="0"
                max="10"
                id="bedCount"
                name="bedCount"
                defaultValue={existingJob?.bedCount ?? ""}
                placeholder="0"
              />
            </FieldWrap>

            <FieldWrap label="Bath count">
              <Input
                type="number"
                min="0"
                max="10"
                id="bathCount"
                name="bathCount"
                defaultValue={existingJob?.bathCount ?? ""}
                placeholder="0"
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
              defaultValue={existingJob?.notes || ""}
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
            borderTop: "1px solid rgba(0,95,106,0.10)",
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
          <Link href={isEditing ? `/jobs/${existingJob?.id}` : "/jobs"}>
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
        border: "1px solid rgba(0,95,106,0.08)",
        borderRadius: 16,
        padding: "24px 28px",
        boxShadow: "0 1px 6px rgba(0,95,106,0.05)",
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
