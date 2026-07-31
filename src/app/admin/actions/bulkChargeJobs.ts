"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { chargeJob } from "./chargeJob";

/**
 * Charge a list of completed-but-unpaid jobs in one batch. Each job is
 * charged independently via `chargeJob` so failures on one don't block
 * the rest. Returns a per-job summary the UI can render.
 */
export async function bulkChargeJobs(jobIds: string[]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const eligible = await db.job.findMany({
    where: {
      id: { in: jobIds },
      // An archived job is never chargeable (new fix list item 1).
      deletedAt: null,
      paymentReceived: false,
      status: "COMPLETED",
      isCashJob: false,
    },
    select: { id: true, jobNumber: true, clientName: true },
  });

  const results: Array<{
    jobId: string;
    jobNumber: number;
    clientName: string;
    success: boolean;
    amount?: number;
    error?: string;
  }> = [];

  let okCount = 0;
  let totalCharged = 0;
  for (const job of eligible) {
    const r = await chargeJob(job.id);
    if (r.success) {
      okCount++;
      totalCharged += r.amount ?? 0;
      results.push({
        jobId: job.id,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        success: true,
        amount: r.amount,
      });
    } else {
      results.push({
        jobId: job.id,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        success: false,
        error: r.error,
      });
    }
  }

  revalidatePath("/admin/jobs");
  revalidatePath("/admin/finances");
  revalidatePath("/admin/bulk-charge");

  return {
    success: true,
    attempted: eligible.length,
    succeeded: okCount,
    failed: eligible.length - okCount,
    totalCharged,
    results,
  };
}
