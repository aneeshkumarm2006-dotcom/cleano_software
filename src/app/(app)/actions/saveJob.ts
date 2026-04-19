"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";

const VALID_PAYMENT_TYPES = [
  "CASH",
  "CHEQUE",
  "E_TRANSFER",
  "CREDIT_CARD",
  "OTHER",
] as const;

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
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    const cleanerIds = formData.getAll("cleaners") as string[];
    const addOnsRaw = formData.get("addOns") as string | null;
    let addOns: Array<{ name: string; price: number }> = [];
    if (addOnsRaw) {
      try {
        const parsed = JSON.parse(addOnsRaw);
        if (Array.isArray(parsed)) {
          addOns = parsed
            .filter((a) => a && typeof a.name === "string" && a.name.trim())
            .map((a) => ({
              name: String(a.name).trim(),
              price: Number(a.price) || 0,
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

    if (clientId && !clientName) {
      const existing = await db.client.findUnique({ where: { id: clientId } });
      if (existing) clientName = existing.name;
    }

    const jobData: any = {
      employeeId: session.user.id,
      clientName,
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
      price: parseOptionalFloat(formData.get("price")),
      employeePay: parseOptionalFloat(formData.get("employeePay")),
      totalTip: parseOptionalFloat(formData.get("totalTip")),
      parking: parseOptionalFloat(formData.get("parking")),
      paymentReceived: formData.get("paymentReceived") === "on",
      invoiceSent: formData.get("invoiceSent") === "on",
      notes: (formData.get("notes") as string) || null,
      paymentType,
      discountAmount: parseOptionalFloat(formData.get("discountAmount")),
      bedCount: parseOptionalInt(formData.get("bedCount")),
      bathCount: parseOptionalInt(formData.get("bathCount")),
      payRateMultiplier:
        parseOptionalFloat(formData.get("payRateMultiplier")) ?? 1.0,
    };

    const editingJobId = formData.get("jobId") as string | null;
    const statusRaw = (formData.get("status") as string) || null;

    if (editingJobId) {
      // Fetch existing job to detect status change to CANCELLED
      const existingJob = statusRaw === "CANCELLED"
        ? await db.job.findUnique({ where: { id: editingJobId }, select: { status: true, clientName: true } })
        : null;

      const updateData: any = {
        ...jobData,
        cleaners:
          cleanerIds.length > 0
            ? { set: cleanerIds.map((id) => ({ id })) }
            : { set: [] },
        addOns: {
          deleteMany: {},
          create: addOns.map((a) => ({ name: a.name, price: a.price })),
        },
      };

      if (statusRaw) {
        updateData.status = statusRaw;
      }

      await db.job.update({
        where: { id: editingJobId },
        data: updateData,
      });

      // Create cancellation alert if job was just cancelled
      if (
        statusRaw === "CANCELLED" &&
        existingJob &&
        existingJob.status !== "CANCELLED"
      ) {
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
      }

      if (jobData.startTime) {
        await invalidateCalendarDay(
          jobData.startTime.toISOString().slice(0, 10)
        );
      }
      revalidatePath("/jobs");
      revalidatePath(`/jobs/${editingJobId}`);
      revalidatePath("/analytics");
      return { success: true };
    } else {
      if (cleanerIds.length > 0) {
        jobData.cleaners = {
          connect: cleanerIds.map((id) => ({ id })),
        };
      }
      if (addOns.length > 0) {
        jobData.addOns = {
          create: addOns.map((a) => ({ name: a.name, price: a.price })),
        };
      }

      const newJob = await db.job.create({ data: jobData });

      if (jobData.startTime) {
        await invalidateCalendarDay(
          jobData.startTime.toISOString().slice(0, 10)
        );
      }
      revalidatePath("/jobs");
      revalidatePath("/analytics");
      return { success: true, jobId: newJob.id };
    }
  } catch (error) {
    console.error("Error saving job:", error);
    return { error: "Failed to save job. Please try again." };
  }
}
