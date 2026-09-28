"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
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
 *  - A job with ANY job-chat message is refused outright and stays archived,
 *    because JobChatMessage cascades and CLN-P0-3-15 wants that conversation
 *    kept. See the note at the guard below.
 *
 * Prisma cascade rules (schema): JobAddOn / JobProductUsage / JobLog /
 * JobAssignment / JobPhoto cascade away with the job; the JobCleaners join is
 * auto-cleared. JobChatMessage also cascades, which is exactly why a job that
 * has any is never eligible. Invoice / InvoiceLineItem / Transaction /
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
  const candidates = await db.job.findMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    // jobNumber + clientName are captured for the audit record below: once the
    // rows are gone, the ids mean nothing to a human reading the log.
    select: {
      id: true,
      startTime: true,
      jobNumber: true,
      clientName: true,
      _count: { select: { chatMessages: true } },
    },
  });
  if (candidates.length === 0) {
    return { error: "These jobs must be archived before permanent delete" as const };
  }

  // A job that was ever discussed stays archived (Stage 6 Q7, option B).
  //
  // JobChatMessage.job is onDelete: Cascade with a NOT NULL jobId, so deleting
  // the job destroys the whole conversation. That contradicts CLN-P0-3-15,
  // which wants job chat kept as a permanent record "for complaints, disputes,
  // access issues, quality reviews, and payment disputes" — exactly the
  // conversations someone would later want to read. Invoice, Transaction,
  // Complaint and CleanerStrike all use SetNull for that reason; chat is the
  // one exception.
  //
  // Blocking here rather than widening the FK keeps the schema additive: no
  // nullable jobId, no orphaned threads with no job to read them from, and no
  // new UI to reach them. The cost is that "you archived it, and it had a
  // conversation on it, so it stays archived" — which is the right trade for a
  // business that needs disputes on record. Hiding a message already copies the
  // original into ActivityLog, but only moderated ones, so that mitigation
  // never covered an ordinary thread.
  const withChat = candidates.filter((j) => j._count.chatMessages > 0);
  const eligible = candidates.filter((j) => j._count.chatMessages === 0);

  if (eligible.length === 0) {
    return {
      error: `Job${withChat.length === 1 ? "" : "s"} #${withChat
        .map((j) => j.jobNumber)
        .join(", #")} ${withChat.length === 1 ? "has" : "have"} chat history and must stay archived.` as const,
    };
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
        // What the selection asked for but the chat guard held back, so the
        // log explains its own count rather than looking like a partial failure.
        skippedForChatHistory: withChat.map((j) => j.jobNumber),
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
    return {
      success: true as const,
      count: eligible.length,
      skipped: withChat.length,
      skippedJobNumbers: withChat.map((j) => j.jobNumber),
    };
  } catch (error) {
    console.error("permanentlyDeleteJobs", error);
    return { error: "Failed to permanently delete the selected jobs" as const };
  }
}
