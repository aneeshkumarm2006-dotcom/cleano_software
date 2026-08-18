"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ChecklistItemStatus } from "@prisma/client";
import { sendAdminChecklistCompleted } from "@/lib/email";

interface UpdateChecklistItemInput {
  itemId: string;
  status?: ChecklistItemStatus;
  notes?: string | null;
}

export async function updateChecklistItem(input: UpdateChecklistItemInput) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false as const, error: "Not authenticated" };
  }

  try {
    const item = await db.jobChecklistItem.findUnique({
      where: { id: input.itemId },
      include: {
        checklist: {
          include: {
            job: { include: { cleaners: { select: { id: true } } } },
          },
        },
      },
    });
    if (!item) return { success: false as const, error: "Item not found" };

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const isOwnChecklist = item.checklist.employeeId === session.user.id;
    const isJobLead = item.checklist.job.employeeId === session.user.id;
    const isCleaner = item.checklist.job.cleaners.some(
      (c) => c.id === session.user.id
    );

    if (!isAdmin && !isOwnChecklist && !isJobLead && !isCleaner) {
      return { success: false as const, error: "Not authorized" };
    }

    const data: {
      status?: ChecklistItemStatus;
      notes?: string | null;
      completedAt?: Date | null;
    } = {};
    if (input.status !== undefined) {
      data.status = input.status;
      data.completedAt = input.status === "COMPLETED" ? new Date() : null;
    }
    if (input.notes !== undefined) {
      data.notes = input.notes?.trim() ? input.notes.trim() : null;
    }

    await db.jobChecklistItem.update({
      where: { id: input.itemId },
      data,
    });

    // After marking an item COMPLETED, check whether the whole checklist
    // is now done — if so, notify admin (gated by `admin.checklist.completed`).
    if (input.status === "COMPLETED") {
      const itemsAfter = await db.jobChecklistItem.findMany({
        where: { checklistId: item.checklistId },
        select: { status: true },
      });
      const allDone =
        itemsAfter.length > 0 &&
        itemsAfter.every((i) => i.status === "COMPLETED");
      if (allDone) {
        const jobInfo = await db.job.findUnique({
          where: { id: item.checklist.jobId },
          select: { jobNumber: true, clientName: true },
        });
        if (jobInfo) {
          sendAdminChecklistCompleted({
            jobId: item.checklist.jobId,
            jobNumber: jobInfo.jobNumber,
            clientName: jobInfo.clientName,
            cleanerName: session.user.name ?? "Cleaner",
            itemCount: itemsAfter.length,
          }).catch((e) => console.error("admin checklist email", e));
        }
      }
    }

    revalidatePath(`/cleaners/my-jobs/${item.checklist.jobId}`);
    // The clock screen ticks the same checklist through the same action, and it
    // is a route of its own — without this it kept serving the payload it was
    // rendered with, so its progress bar and its clock-out gate disagreed with
    // the boxes the cleaner had just ticked. Every other action on these two
    // screens (clockIn, clockOut, markOnMyWay, jobBreak) already revalidates
    // both paths; this one only ever did the first.
    revalidatePath(`/cleaners/my-jobs/${item.checklist.jobId}/clock`);
    return { success: true as const };
  } catch (error) {
    console.error("Error updating checklist item:", error);
    return { success: false as const, error: "Failed to update item" };
  }
}
