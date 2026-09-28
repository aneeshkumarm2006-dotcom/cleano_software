"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Manager override for a job that landed on the Rag Wash flagged list.
 * Records who cleared it and when; the job is removed from the flagged
 * tab on the next render. The credit amount is not changed (the cap was
 * removed in the median switchover).
 */
export async function overrideRagWashFlag(jobId: string, note?: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, washReviewOverrideAt: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (job.washReviewOverrideAt) {
    return { success: false, error: "Already reviewed" };
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    const __t0 = await tx.job.update({
        where: { id: jobId },
        data: {
          washReviewOverrideAt: now,
          washReviewOverrideBy: session.user.id,
        },
      });
    const __t1 = await tx.jobLog.create({
        data: {
          jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          description: note?.trim()
            ? `Rag Wash flag cleared by manager. ${note.trim()}`
            : `Rag Wash flag cleared by manager.`,
        },
      });
    return [__t0, __t1];
  });

  revalidatePath("/admin/wash-payouts");
  return { success: true };
}
