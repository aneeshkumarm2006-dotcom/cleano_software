"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { sendInvoiceEmail } from "@/lib/email";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { fmtDate } from "@/lib/time";
import { isJobTaxExempt } from "@/lib/tax.server";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";

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

interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  jobId?: string | null;
}

interface CreateInvoiceParams {
  clientId: string;
  jobId?: string | null;
  // Consolidated invoice: one line item per selected job, each linked via
  // InvoiceLineItem.jobId so paying the invoice pays every covered job.
  jobIds?: string[];
  lineItems: LineItemInput[];
  discountAmount?: number;
  discountPercent?: number;
  notes?: string | null;
  dueDate?: string | null;
}

export async function createInvoice(params: CreateInvoiceParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    if (!params.clientId) {
      return { success: false, error: "Client is required" };
    }
    if (
      (!params.lineItems || params.lineItems.length === 0) &&
      (!params.jobIds || params.jobIds.length === 0)
    ) {
      return { success: false, error: "Add at least one line item or select jobs" };
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

    // Selected jobs become the leading line items of a consolidated invoice.
    const jobIds = Array.from(new Set((params.jobIds ?? []).filter(Boolean)));
    const selectedJobs = jobIds.length
      ? await db.job.findMany({
          where: { id: { in: jobIds }, deletedAt: null, clientId: params.clientId },
          select: {
            id: true,
            jobNumber: true,
            jobType: true,
            startTime: true,
            price: true,
            discountAmount: true,
            // Needed so an exempt job's amount is excluded from the taxable
            // base on a consolidated invoice (item 7).
            isCashJob: true,
            taxExempt: true,
          },
          orderBy: { startTime: "asc" },
        })
      : [];
    // Admin's own service names on invoice lines (item 20).
    const { labels: serviceLabels } = await getServiceCatalogWithLabels();
    const jobLineItems = selectedJobs.map((job, idx) => ({
      description: `Job #${job.jobNumber}${job.jobType ? ` — ${jobTypeLabel(job.jobType, serviceLabels)}` : ""} — ${fmtDate(job.startTime, { month: "short", day: "numeric", year: "numeric" })}`,
      quantity: 1,
      unitPrice: Math.max(0, (job.price ?? 0) - (job.discountAmount ?? 0)),
      amount: Math.max(0, (job.price ?? 0) - (job.discountAmount ?? 0)),
      sortOrder: idx,
      jobId: job.id,
    }));

    const lineItemsData = [
      ...jobLineItems,
      ...params.lineItems.map((li, idx) => ({
        description: li.description.trim(),
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        amount: li.quantity * li.unitPrice,
        sortOrder: jobLineItems.length + idx,
        jobId: li.jobId || null,
      })),
    ];

    const subtotal = lineItemsData.reduce((sum, li) => sum + li.amount, 0);

    // Resolve discount: explicit amount > explicit percent > client default percent
    let discount = 0;
    if (
      params.discountAmount !== undefined &&
      params.discountAmount !== null &&
      params.discountAmount > 0
    ) {
      discount = params.discountAmount;
    } else if (
      params.discountPercent !== undefined &&
      params.discountPercent !== null &&
      params.discountPercent > 0
    ) {
      discount = +(subtotal * (params.discountPercent / 100)).toFixed(2);
    } else {
      const client = await db.client.findUnique({
        where: { id: params.clientId },
        select: { discountPercent: true },
      });
      const pct = client?.discountPercent ?? 0;
      if (pct > 0) {
        discount = +(subtotal * (pct / 100)).toFixed(2);
      }
    }

    // An invoice can consolidate several jobs, so exemption is applied PER JOB
    // rather than all-or-nothing: the amounts of tax-exempt jobs are removed
    // from the taxable base, while other jobs and manual line items are still
    // taxed (item 7 — "invoice records should match the tax setting on the job").
    const exemptAmount = selectedJobs
      .filter((j) => isJobTaxExempt(j))
      .reduce(
        (sum, j) => sum + Math.max(0, (j.price ?? 0) - (j.discountAmount ?? 0)),
        0
      );

    const taxableAmount = subtotal - discount;
    const taxableBase = Math.max(0, taxableAmount - exemptAmount);
    const gstAmount = (taxableBase * gstRate) / 100;
    const qstAmount = (taxableBase * qstRate) / 100;
    const totalAmount = taxableAmount + gstAmount + qstAmount;

    const invoiceNumber = await generateInvoiceNumber();

    const dueDate = params.dueDate ? new Date(params.dueDate) : null;

    const invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        status: "DRAFT",
        clientId: params.clientId,
        // Single-job invoices keep the primary link; a consolidated invoice
        // links jobs per line item instead.
        jobId: params.jobId || (selectedJobs.length === 1 ? selectedJobs[0].id : null),
        subtotal,
        gstAmount,
        qstAmount,
        discountAmount: discount,
        totalAmount,
        notes: params.notes?.trim() || null,
        dueDate,
        lineItems: {
          create: lineItemsData,
        },
      },
    });

    revalidatePath("/admin/invoices");

    // Customer "new invoice" email — gated by `cust.invoice.new`.
    const client = await db.client.findUnique({
      where: { id: params.clientId },
      select: { name: true, email: true },
    });
    if (client?.email) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      sendInvoiceEmail({
        to: client.email,
        recipient: "CUSTOMER",
        event: "new",
        invoiceNumber: invoice.invoiceNumber,
        amount: totalAmount,
        clientName: client.name,
        link: `${appUrl}/bookings${invoice.jobId ? `/${invoice.jobId}` : ""}`,
      }).catch((e) => console.error("customer new-invoice email", e));
    }

    return { success: true, invoiceId: invoice.id };
  } catch (error) {
    console.error("Error creating invoice:", error);
    return { success: false, error: "Failed to create invoice" };
  }
}
