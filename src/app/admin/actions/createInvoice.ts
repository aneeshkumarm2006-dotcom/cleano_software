"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { sendInvoiceEmail } from "@/lib/email";

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
}

interface CreateInvoiceParams {
  clientId: string;
  jobId?: string | null;
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
    if (!params.lineItems || params.lineItems.length === 0) {
      return { success: false, error: "At least one line item is required" };
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

    const lineItemsData = params.lineItems.map((li, idx) => ({
      description: li.description.trim(),
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.quantity * li.unitPrice,
      sortOrder: idx,
    }));

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

    const taxableAmount = subtotal - discount;
    const gstAmount = (taxableAmount * gstRate) / 100;
    const qstAmount = (taxableAmount * qstRate) / 100;
    const totalAmount = taxableAmount + gstAmount + qstAmount;

    const invoiceNumber = await generateInvoiceNumber();

    const dueDate = params.dueDate ? new Date(params.dueDate) : null;

    const invoice = await db.invoice.create({
      data: {
        invoiceNumber,
        status: "DRAFT",
        clientId: params.clientId,
        jobId: params.jobId || null,
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
