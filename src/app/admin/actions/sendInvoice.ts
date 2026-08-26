"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { sendInvoiceEmail } from "@/lib/email";
import { buildInvoicePdfBuffer, loadInvoiceData } from "@/lib/invoice-pdf";
import { currentAppUrl } from "@/lib/org-url";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

export async function sendInvoice(invoiceId: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) return { success: false, error: "Invoice not found" };

    if (invoice.status === "CANCELLED") {
      return {
        success: false,
        error: "Cancelled invoices cannot be emailed",
      };
    }

    const wasDraft = invoice.status === "DRAFT";
    await db.invoice.update({
      where: { id: invoiceId },
      data: {
        ...(wasDraft ? { status: "SENT" } : {}),
        sentAt: new Date(),
      },
    });

    // If linked to a job, update the job's invoiceSent flag
    if (invoice.jobId) {
      await db.$transaction([
        db.job.update({
          where: { id: invoice.jobId },
          data: { invoiceSent: true },
        }),
        db.jobLog.create({
          data: {
            jobId: invoice.jobId,
            userId: guard.session.user.id,
            action: "INVOICE_SENT",
            field: "invoiceSent",
            oldValue: "false",
            newValue: "true",
            description: `Invoice ${invoice.invoiceNumber} sent by ${guard.session.user.name}`,
          },
        }),
      ]);
      revalidatePath(`/admin/jobs/${invoice.jobId}`);
      revalidatePath("/admin/jobs");
    }

    revalidatePath("/admin/invoices");
    revalidatePath(`/admin/invoices/${invoiceId}`);

    // Email the customer with the invoice PDF attached.
    const fresh = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: { select: { name: true, email: true } } },
    });
    if (!fresh?.client?.email) {
      return {
        success: false,
        error:
          "Invoice status updated, but the client has no email on file — nothing was sent.",
      };
    }

    const appUrl = await currentAppUrl();
    let pdfAttachment: { filename: string; content: Buffer } | undefined;
    try {
      const data = await loadInvoiceData(invoiceId);
      if (data) {
        const buffer = await buildInvoicePdfBuffer(data);
        pdfAttachment = {
          filename: `invoice-${fresh.invoiceNumber}.pdf`,
          content: buffer,
        };
      }
    } catch (e) {
      console.error("Could not build invoice PDF for email", e);
    }

    const result = await sendInvoiceEmail({
      to: fresh.client.email,
      recipient: "CUSTOMER",
      event: wasDraft ? "new" : "resend",
      invoiceNumber: fresh.invoiceNumber,
      amount: fresh.totalAmount,
      clientName: fresh.client.name,
      link: `${appUrl}/bookings${fresh.jobId ? `/${fresh.jobId}` : ""}`,
      pdfAttachment,
    });

    if (!result.ok) {
      return {
        success: false,
        error:
          ("error" in result && typeof result.error === "string"
            ? result.error
            : null) ?? "Email delivery failed",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending invoice:", error);
    return { success: false, error: "Failed to send invoice" };
  }
}
