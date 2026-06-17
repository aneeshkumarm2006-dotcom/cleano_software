"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";

// "AUTO" clears the override so the booking follows the admin-configured
// service-type mapping again. Otherwise an explicit per-job label.
type Choice = "AUTO" | "ROUTINE" | "IMPORTANT" | "NONE";

/**
 * Operations-manager switch for a single booking's calendar priority badge.
 * Overrides the automatic service-type label until set back to "AUTO".
 */
export async function setJobPriorityLabel(jobId: string, choice: Choice) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  if (!["AUTO", "ROUTINE", "IMPORTANT", "NONE"].includes(choice)) {
    return { success: false, error: "Invalid label" };
  }

  try {
    const job = await db.job.update({
      where: { id: jobId },
      data: { priorityLabel: choice === "AUTO" ? null : choice },
      select: { startTime: true },
    });

    if (job.startTime) {
      await invalidateCalendarDay(job.startTime.toISOString().slice(0, 10));
    }
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`);
    return { success: true };
  } catch (error) {
    console.error("Error setting job priority label:", error);
    return { success: false, error: "Failed to update label" };
  }
}
