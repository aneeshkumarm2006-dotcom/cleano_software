"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function addJobNote(jobId: string, note: string) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  if (!note || note.trim().length === 0) {
    return { success: false, error: "Note cannot be empty" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        employee: true,
        cleaners: true,
      },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    // Verify the user is assigned to this job
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some(
      (cleaner) => cleaner.id === session.user.id
    );
    const isAdmin =
      (session.user as any).role === "ADMIN" ||
      (session.user as any).role === "OWNER";

    if (!isEmployee && !isCleaner && !isAdmin) {
      return { success: false, error: "You do not have access to this job" };
    }

    // Create the job log entry for the note
    await db.jobLog.create({
      data: {
        jobId,
        userId: session.user.id,
        action: "NOTE_ADDED",
        description: note.trim(),
      },
    });

    revalidatePath("/cleaners/my-jobs");
    revalidatePath(`/cleaners/my-jobs/${jobId}`);
    revalidatePath("/admin/calendar");

    return { success: true };
  } catch (error) {
    console.error("Error adding job note:", error);
    return { success: false, error: "Failed to add note" };
  }
}
