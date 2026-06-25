"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { InvoiceStatus } from "@prisma/client";
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

interface LineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface UpdateInvoiceParams {
  id: string;
  status?: InvoiceStatus;
  clientId?: string;
  lineItems?: LineItemInput[];
  discountAmount?: number;
  notes?: string | null;
  dueDate?: string | null;
}

export async function updateInvoice(params: UpdateInvoiceParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const existing = await db.invoice.findUnique({
      where: { id: params.id },
    });
    if (!existing) return { success: false, error: "Invoice not found" };

    // If line items are being updated, recalculate totals
    if (params.lineItems) {
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
      const discount = params.discountAmount ?? existing.discountAmount;
      const taxableAmount = subtotal - discount;
      const gstAmount = (taxableAmount * gstRate) / 100;
      const qstAmount = (taxableAmount * qstRate) / 100;
      const totalAmount = taxableAmount + gstAmount + qstAmount;

      // Delete existing line items and recreate
      await db.invoiceLineItem.deleteMany({
        where: { invoiceId: params.id },
      });

      await db.invoice.update({
        where: { id: params.id },
        data: {
          status: params.status,
          clientId: params.clientId,
          subtotal,
          gstAmount,
          qstAmount,
          discountAmount: discount,
          totalAmount,
          notes: params.notes !== undefined ? (params.notes?.trim() || null) : undefined,
          dueDate: params.dueDate !== undefined ? (params.dueDate ? new Date(params.dueDate) : null) : undefined,
          lineItems: {
            create: lineItemsData,
          },
        },
      });
    } else {
      // Simple update without line items
      const updateData: Record<string, unknown> = {};
      if (params.status !== undefined) updateData.status = params.status;
      if (params.clientId !== undefined) updateData.clientId = params.clientId;
      if (params.notes !== undefined) updateData.notes = params.notes?.trim() || null;
      if (params.dueDate !== undefined) updateData.dueDate = params.dueDate ? new Date(params.dueDate) : null;

      if (params.status === "PAID") {
        updateData.paidAt = new Date();
      }

      await db.invoice.update({
        where: { id: params.id },
        data: updateData,
      });
    }

    revalidatePath("/admin/invoices");
    revalidatePath(`/admin/invoices/${params.id}`);

    // Notifications — gated. Detect status transitions.
    const fresh = await db.invoice.findUnique({
      where: { id: params.id },
      include: { client: { select: { name: true, email: true } } },
    });
    if (fresh) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const link = `${appUrl}/bookings${fresh.jobId ? `/${fresh.jobId}` : ""}`;
      // Status changed to PAID → admin + customer charge confirmation
      if (params.status === "PAID" && existing.status !== "PAID") {
        if (fresh.client?.email) {
          sendInvoiceEmail({
            to: fresh.client.email,
            recipient: "CUSTOMER",
            event: "charge",
            invoiceNumber: fresh.invoiceNumber,
            amount: fresh.totalAmount,
            clientName: fresh.client.name,
            link,
          }).catch((e) => console.error("customer invoice-charge", e));
        }
        // Admin email is gated by a separate row.
        const admins = await db.user.findMany({
          where: { role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] } },
          select: { email: true },
        });
        for (const a of admins) {
          sendInvoiceEmail({
            to: a.email,
            recipient: "ADMIN",
            event: "charge",
            invoiceNumber: fresh.invoiceNumber,
            amount: fresh.totalAmount,
          }).catch((e) => console.error("admin invoice-charge", e));
        }
      } else if (params.lineItems || params.status !== undefined) {
        // Non-PAID update → customer "Invoice updated"
        if (fresh.client?.email) {
          sendInvoiceEmail({
            to: fresh.client.email,
            recipient: "CUSTOMER",
            event: "update",
            invoiceNumber: fresh.invoiceNumber,
            amount: fresh.totalAmount,
            clientName: fresh.client.name,
            link,
          }).catch((e) => console.error("customer invoice-update", e));
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Error updating invoice:", error);
    return { success: false, error: "Failed to update invoice" };
  }
}
