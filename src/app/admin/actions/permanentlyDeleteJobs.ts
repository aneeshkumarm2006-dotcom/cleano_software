"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { invalidateCalendarDay } from "./invalidateCalendarDay";
import { logActivity } from "@/lib/activity-log";

/**
 * Permanent (hard) delete of ARCHIVED jobs (fix 8). Separate from
 * archive/unarchive — this removes the row entirely from Jobs, Calendar,
 * Archived, cleaner views and payroll. Admin-only cleanup for test jobs,
 * duplicate imports, or incorrect imported jobs.
 *
 * Safety rails:
 *  - OWNER/ADMIN only.
 *  - Only jobs that are ALREADY archived (deletedAt set) can be hard-deleted,
 *    so this can never nuke a live booking. Archive first, then permanently
 *    delete — matching the confirming two-step the UI enforces.
 *
 * Prisma cascade rules (schema): JobAddOn / JobProductUsage / JobLog /
 * JobAssignment / JobChatMessage / JobPhoto cascade away with the job; the
 * JobCleaners join is auto-cleared. Invoice / InvoiceLineItem / Transaction /
 * Complaint / CleanerStrike use onDelete: SetNull, so financial + audit history
 * is preserved (decoupled from the deleted job) rather than destroyed. Recurring
 * child jobs survive with parentJobId nulled.
 */
export async function permanentlyDeleteJobs(jobIds: string[]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" as const };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }

  const ids = Array.from(
    new Set((jobIds ?? []).filter((id) => typeof id === "string" && id))
  );
  if (ids.length === 0) return { error: "Nothing selected" as const };

  // Only archived jobs are eligible — a live booking can never be hard-deleted.
  const eligible = await db.job.findMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    // jobNumber + clientName are captured for the audit record below: once the
    // rows are gone, the ids mean nothing to a human reading the log.
    select: { id: true, startTime: true, jobNumber: true, clientName: true },
  });
  if (eligible.length === 0) {
    return { error: "These jobs must be archived before permanent delete" as const };
  }

  try {
    await db.job.deleteMany({ where: { id: { in: eligible.map((j) => j.id) } } });

    // Irreversible destruction of business records leaves a trace. Nothing on
    // any delete path used to write one, which is why 1533 jobs vanished from
    // this database in July 2026 with no way to tell who did it or when.
    // JobLog can't serve here — it cascades away with the job.
    await logActivity({
      category: "ADMIN",
      action: "job.permanent_delete",
      actorId: session.user.id,
      actorLabel: session.user.email ?? session.user.name ?? null,
      targetType: "job",
      targetId: eligible.length === 1 ? eligible[0].id : null,
      message: `Permanently deleted ${eligible.length} archived job${eligible.length === 1 ? "" : "s"}`,
      metadata: {
        count: eligible.length,
        jobNumbers: eligible.map((j) => j.jobNumber),
        clients: Array.from(new Set(eligible.map((j) => j.clientName))).slice(0, 50),
      },
    });

    // Refresh any calendar days those jobs touched.
    const days = new Set(
      eligible
        .map((j) => j.startTime?.toISOString().slice(0, 10))
        .filter((d): d is string => !!d)
    );
    for (const d of days) await invalidateCalendarDay(d).catch(() => {});

    revalidatePath("/admin/jobs");
    revalidatePath("/admin/calendar");
    return { success: true as const, count: eligible.length };
  } catch (error) {
    console.error("permanentlyDeleteJobs", error);
    return { error: "Failed to permanently delete the selected jobs" as const };
  }
}
