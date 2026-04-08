"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function updateJobDates(
  jobId: string,
  startTime: Date,
  endTime?: Date
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    // Check if user has permission to update this job
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { employeeId: true },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    // Check user role - admins/owners can update any job
    const isAdmin =
      (session.user as any).role === "ADMIN" ||
      (session.user as any).role === "OWNER";

    // Regular employees can only update their own jobs
    if (!isAdmin && job.employeeId !== session.user.id) {
      return { success: false, error: "Permission denied" };
    }

    // Update the job
    await db.job.update({
      where: { id: jobId },
      data: {
        startTime,
        endTime,
        jobDate: startTime, // Keep jobDate in sync with startTime
      },
    });

    // Revalidate the calendar page to show updated data
    revalidatePath("/calendar");
    revalidatePath("/jobs");

    return { success: true };
  } catch (error) {
    console.error("Error updating job dates:", error);
    return { success: false, error: "Failed to update job dates" };
  }
}

