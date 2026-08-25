"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { ACTIVE_VALUE_SELECT } from "@/lib/metrics";
import { activeSubtotal } from "@/lib/job-money";

export interface InvoiceJobOption {
  id: string;
  jobNumber: number;
  jobType: string | null;
  startTime: string;
  /**
   * The ACTIVE value of the job — base + add-ons, or the override total (fix
   * 3). This is what the invoice line will carry, and `generateInvoiceFromJob`
   * builds that line from `computeJobMoney`, so quoting `price − discount` in
   * the picker meant the admin chose jobs by one number and invoiced another.
   */
  amount: number;
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
      ...ACTIVE_VALUE_SELECT,
      id: true,
      jobNumber: true,
      jobType: true,
      startTime: true,
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
      amount: activeSubtotal(j),
      invoiceSent: j.invoiceSent,
      paymentReceived: j.paymentReceived,
    })),
  };
}
