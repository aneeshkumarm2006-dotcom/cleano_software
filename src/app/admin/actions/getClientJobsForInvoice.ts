"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";

export interface InvoiceJobOption {
  id: string;
  jobNumber: number;
  jobType: string | null;
  startTime: string;
  amount: number; // price − discount, what the invoice line will carry
  invoiceSent: boolean;
  paymentReceived: boolean;
}

// Jobs eligible for a (consolidated) invoice for one client: live, not
// cancelled, not already paid. Already-invoiced jobs are included but flagged
// so the admin can see them.
export async function getClientJobsForInvoice(
  clientId: string
): Promise<{ success: boolean; jobs: InvoiceJobOption[] }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session || (role !== "OWNER" && role !== "ADMIN")) {
    return { success: false, jobs: [] };
  }

  const jobs = await db.job.findMany({
    where: {
      clientId,
      deletedAt: null,
      status: { not: "CANCELLED" },
      paymentReceived: false,
    },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      startTime: true,
      price: true,
      discountAmount: true,
      invoiceSent: true,
      paymentReceived: true,
    },
    orderBy: { startTime: "desc" },
    take: 100,
  });

  return {
    success: true,
    jobs: jobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      jobType: j.jobType,
      startTime: j.startTime.toISOString(),
      amount: Math.max(0, (j.price ?? 0) - (j.discountAmount ?? 0)),
      invoiceSent: j.invoiceSent,
      paymentReceived: j.paymentReceived,
    })),
  };
}
