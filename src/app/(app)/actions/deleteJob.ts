"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";

export async function deleteJob(jobId: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { error: "Unauthorized" };
  }

  try {
    // Check if user is admin or owner of the job
    const job = await db.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return { error: "Job not found" };
    }

    const isAdmin =
      (session.user as any).role === "ADMIN" ||
      (session.user as any).role === "OWNER";

    if (!isAdmin && job.employeeId !== session.user.id) {
      return { error: "You do not have permission to delete this job" };
    }

    await db.job.delete({
      where: { id: jobId },
    });

    if (job.startTime) {
      await invalidateCalendarDay(job.startTime.toISOString().slice(0, 10));
    }
    revalidatePath("/jobs");
    return { success: true };
  } catch (error) {
    console.error("Error deleting job:", error);
    return { error: "Failed to delete job. Please try again." };
  }
}

