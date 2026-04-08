"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

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

    await db.$transaction([
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
    ]);

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");

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

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");

    return { success: true, newStatus };
  } catch (error) {
    console.error("Error toggling invoice status:", error);
    return { success: false, error: "Failed to update invoice status" };
  }
}

