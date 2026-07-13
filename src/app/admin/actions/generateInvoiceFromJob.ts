"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { jobTypeLabel } from "@/lib/calendar-labels";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

async function generateInvoiceNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `INV-${year}${month}`;

  const latest = await db.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });

  let seq = 1;
  if (latest) {
    const lastSeq = parseInt(latest.invoiceNumber.slice(prefix.length + 1), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export async function generateInvoiceFromJob(jobId: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        client: true,
        addOns: true,
        invoices: { select: { id: true }, take: 1 },
      },
    });

    if (!job) return { success: false, error: "Job not found" };

    // If invoice already exists for this job, return it
    if (job.invoices.length > 0) {
      return { success: true, invoiceId: job.invoices[0].id, existing: true };
    }

    // Need a client to generate an invoice
    if (!job.clientId && !job.clientName) {
      return { success: false, error: "Job has no client information" };
    }

    // If no clientId, try to find or create client from clientName
    let clientId = job.clientId;
    if (!clientId) {
      const existingClient = await db.client.findFirst({
        where: { name: job.clientName },
      });
      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const newClient = await db.client.create({
          data: { name: job.clientName },
        });
        clientId = newClient.id;
        // Link client to job
        await db.job.update({
          where: { id: jobId },
          data: { clientId },
        });
      }
    }

    // Get tax config
    const taxConfig = await db.appSetting.findUnique({
      where: { key: "tax.config" },
    });
    const raw = (taxConfig?.value ?? null) as {
      gstRate?: number;
      qstRate?: number;
    } | null;
    const gstRate = raw?.gstRate ?? 5;
    const qstRate = raw?.qstRate ?? 9.975;

    // Build line items
    const lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      sortOrder: number;
    }> = [];

    // Main service line
    const basePrice = job.price ?? 0;
    lineItems.push({
      description: `Cleaning Service${job.jobType ? ` (${jobTypeLabel(job.jobType)})` : ""}${job.bedCount || job.bathCount ? ` — ${job.bedCount ?? 0} bed / ${job.bathCount ?? 0} bath` : ""}`,
      quantity: 1,
      unitPrice: basePrice,
      amount: basePrice,
      sortOrder: 0,
    });

    // Add-ons
    if (job.addOns.length > 0) {
      job.addOns.forEach((addon, idx) => {
        lineItems.push({
          description: addon.name,
          quantity: 1,
          unitPrice: addon.price,
          amount: addon.price,
          sortOrder: idx + 1,
        });
      });
    }

    const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);

    // Use job's explicit discount when set (including 0 = admin opted out).
    // If unset (null), fall back to the client's default discount %.
    let discount = job.discountAmount ?? 0;
    if (job.discountAmount === null || job.discountAmount === undefined) {
      const clientForDiscount = await db.client.findUnique({
        where: { id: clientId },
        select: { discountPercent: true },
      });
      const pct = clientForDiscount?.discountPercent ?? 0;
      if (pct > 0 && subtotal > 0) {
        discount = +(subtotal * (pct / 100)).toFixed(2);
      }
    }

    const taxableAmount = subtotal - discount;
    const gstAmount = (taxableAmount * gstRate) / 100;
    const qstAmount = (taxableAmount * qstRate) / 100;
    const totalAmount = taxableAmount + gstAmount + qstAmount;

    const invoiceNumber = await generateInvoiceNumber();

    // Set due date to 30 days from now
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        status: "DRAFT",
        clientId,
        jobId,
        subtotal,
        gstAmount,
        qstAmount,
        discountAmount: discount,
        totalAmount,
        dueDate,
        lineItems: {
          create: lineItems,
        },
      },
    });

    // Mark job as invoice sent
    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: { invoiceSent: true },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: guard.session.user.id,
          action: "INVOICE_SENT",
          field: "invoiceSent",
          oldValue: "false",
          newValue: "true",
          description: `Invoice ${invoiceNumber} generated by ${guard.session.user.name}`,
        },
      }),
    ]);

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/invoices");

    return { success: true, invoiceId: invoice.id };
  } catch (error) {
    console.error("Error generating invoice from job:", error);
    return { success: false, error: "Failed to generate invoice" };
  }
}
