"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { queueAndSendReceipt, sendCustomerBookingCharged } from "@/lib/email";
import { getTaxRates } from "@/lib/tax.server";

export async function togglePaymentReceived(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Check if user is admin
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const newStatus = !job.paymentReceived;

    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.job.update({
        where: { id: jobId },
        data: {
          paymentReceived: newStatus,
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "PAYMENT_RECEIVED",
          field: "paymentReceived",
          oldValue: job.paymentReceived.toString(),
          newValue: newStatus.toString(),
          description: newStatus
            ? `Payment marked as received by ${session.user.name}`
            : `Payment marked as not received by ${session.user.name}`,
        },
      }),
    ];

    if (newStatus && job.price && job.price > 0) {
      const discount = job.discountAmount ?? 0;
      const netAmount = job.price - discount;
      // Cash jobs are tax exempt. Otherwise prefer the GST/QST stored on the
      // job (set at save/booking/import time); only recompute from the current
      // tax.config rates for older rows saved before taxes were persisted —
      // and on the DISCOUNTED subtotal, not the raw price.
      let taxAmount = 0;
      if (!job.isCashJob) {
        const storedTax = (job.gstAmount ?? 0) + (job.qstAmount ?? 0);
        if (storedTax > 0) {
          taxAmount = storedTax;
        } else {
          const rates = await getTaxRates();
          taxAmount =
            (netAmount * rates.gstRate) / 100 + (netAmount * rates.qstRate) / 100;
        }
      }
      ops.push(
        db.transaction.create({
          data: {
            date: new Date(),
            category: "REVENUE",
            amount: netAmount,
            description: `Revenue from job for ${job.clientName}`,
            jobId: job.id,
            source: job.paymentType ?? null,
            taxAmount,
            isAuto: true,
          },
        })
      );
    } else if (!newStatus) {
      ops.push(
        db.transaction.deleteMany({
          where: {
            jobId: job.id,
            category: "REVENUE",
            isAuto: true,
          },
        })
      );
    }

    await db.$transaction(ops);

    // Send receipt + "booking charged" email when payment is marked received.
    // Gated by the per-booking notifyClient toggle.
    if (newStatus && job.notifyClient) {
      queueAndSendReceipt(jobId).catch(() => {});

      // The receipt has the formal totals; "booking charged" is the simpler
      // confirmation gated by `cust.fee.booking_charged`.
      const fullJob = await db.job.findUnique({
        where: { id: jobId },
        include: { client: { select: { name: true, email: true } } },
      });
      if (fullJob?.client?.email) {
        const amount = (fullJob.price ?? 0) - (fullJob.discountAmount ?? 0);
        sendCustomerBookingCharged({
          to: fullJob.client.email,
          clientName: fullJob.client.name,
          jobId,
          jobNumber: fullJob.jobNumber,
          amount: amount > 0 ? amount : (fullJob.price ?? 0),
          paymentMethod: fullJob.paymentType ?? "Cash / cheque",
        }).catch((e) => console.error("customer booking-charged (manual)", e));
      }
    }

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");
    revalidatePath("/admin/finances");

    return { success: true, newStatus };
  } catch (error) {
    console.error("Error toggling payment status:", error);
    return { success: false, error: "Failed to update payment status" };
  }
}

export async function toggleInvoiceSent(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Check if user is admin
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const newStatus = !job.invoiceSent;

    await db.$transaction([
      db.job.update({
        where: { id: jobId },
        data: {
          invoiceSent: newStatus,
        },
      }),
      db.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "INVOICE_SENT",
          field: "invoiceSent",
          oldValue: job.invoiceSent.toString(),
          newValue: newStatus.toString(),
          description: newStatus
            ? `Invoice marked as sent by ${session.user.name}`
            : `Invoice marked as not sent by ${session.user.name}`,
        },
      }),
    ]);

    revalidatePath(`/admin/jobs/${jobId}`);
    revalidatePath("/admin/jobs");

    return { success: true, newStatus };
  } catch (error) {
    console.error("Error toggling invoice status:", error);
    return { success: false, error: "Failed to update invoice status" };
  }
}

