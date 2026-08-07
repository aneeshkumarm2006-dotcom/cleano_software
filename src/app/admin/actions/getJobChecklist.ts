"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type {
  JobChecklistDTO,
  JobChecklistItemDTO,
} from "./getJobChecklist.types";

/**
 * Fetch the checklist for a job belonging to the current user.
 * Returns null when no checklist has been generated yet.
 */
export async function getJobChecklist(
  jobId: string
): Promise<
  | { success: true; checklist: JobChecklistDTO | null }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      include: {
        cleaners: { select: { id: true } },
      },
    });
    if (!job) return { success: false, error: "Job not found" };

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);
    if (!isAdmin && !isEmployee && !isCleaner) {
      return { success: false, error: "Not authorized for this job" };
    }

    // Ordered by createdAt so this and ensureJobChecklist agree on WHICH row is
    // the real one, for any duplicate that predates the @@unique constraint.
    const checklist = await db.jobChecklist.findFirst({
      where: { jobId, employeeId: session.user.id },
      orderBy: { createdAt: "asc" },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!checklist) {
      return { success: true, checklist: null };
    }

    const items: JobChecklistItemDTO[] = checklist.items.map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description,
      status: it.status,
      isRequired: it.isRequired,
      sortOrder: it.sortOrder,
      notes: it.notes,
      completedAt: it.completedAt,
      group: "standard",
      templateName: null,
    }));

    return {
      success: true,
      checklist: {
        id: checklist.id,
        jobId: checklist.jobId,
        employeeId: checklist.employeeId,
        items,
      },
    };
  } catch (error) {
    console.error("Error loading job checklist:", error);
    return { success: false, error: "Failed to load checklist" };
  }
}
