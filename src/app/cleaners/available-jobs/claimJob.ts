"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function claimJob(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (!role || role === "CLIENT") return { success: false, error: "Not authorized" };

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { cleaners: { select: { id: true } } },
  });
  if (!job) return { success: false, error: "Job not found" };

  const alreadyCleaner = job.cleaners.some((c) => c.id === session.user.id);
  if (alreadyCleaner) return { success: false, error: "You already claimed this job" };

  const currentCount = job.cleaners.length;
  if (currentCount >= job.requiredCleaners) {
    return { success: false, error: "This job is already fully staffed" };
  }

  await db.job.update({
    where: { id: jobId },
    data: { cleaners: { connect: { id: session.user.id } } },
  });

  await db.jobLog.create({
    data: {
      jobId,
      userId: session.user.id,
      action: "UPDATED",
      field: "cleaners",
      description: `${session.user.name} claimed this job`,
    },
  });

  revalidatePath("/cleaners/available-jobs");
  revalidatePath("/cleaners/my-jobs");
  return { success: true };
}
