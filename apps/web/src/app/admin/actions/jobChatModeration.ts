"use server";

import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { logActivity } from "@/lib/activity-log";

/**
 * Admin controls over a booking's chat thread (CLN-P0-3-14).
 *
 * Two levels, because the spec asks for "a specific booking **or user**":
 *   • the booking     — closes this one thread to both parties
 *   • a participant   — blocks that cleaner or customer on every booking
 *
 * Disabling is read-only, never destructive: the thread keeps rendering its
 * full history and only the composer is withdrawn (CLN-P0-3-10 keeps chat
 * visible after completion, CLN-P0-3-15 wants a permanent record). Admins are
 * exempt from the block — moderation is the reason it exists.
 *
 * OWNER/ADMIN only, and every flip writes an ActivityLog row: the columns hold
 * only a timestamp, so who did it and why lives in the audit trail.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export interface JobChatParticipantDTO {
  kind: "client" | "cleaner";
  id: string;
  name: string;
  /** ISO timestamp when this participant was blocked, or null. */
  chatDisabledAt: string | null;
}

export interface JobChatModerationDTO {
  jobId: string;
  /** ISO timestamp when this booking's thread was closed, or null. */
  chatDisabledAt: string | null;
  participants: JobChatParticipantDTO[];
}

/** Current messaging state for a booking and everyone in its thread. */
export async function getJobChatModeration(
  jobId: string
): Promise<Result<JobChatModerationDTO>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      chatDisabledAt: true,
      client: { select: { id: true, name: true, chatDisabledAt: true } },
      employee: { select: { id: true, name: true, chatDisabledAt: true } },
      cleaners: { select: { id: true, name: true, chatDisabledAt: true } },
    },
  });
  if (!job) return { success: false, error: "Job not found" };

  const participants: JobChatParticipantDTO[] = [];
  if (job.client) {
    participants.push({
      kind: "client",
      id: job.client.id,
      name: job.client.name,
      chatDisabledAt: job.client.chatDisabledAt?.toISOString() ?? null,
    });
  }
  // The lead is also a cleaner on the thread; de-duplicate so a lead who is
  // also in `cleaners` doesn't render twice with two switches.
  const seen = new Set<string>();
  for (const c of [...(job.employee ? [job.employee] : []), ...job.cleaners]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    participants.push({
      kind: "cleaner",
      id: c.id,
      name: c.name,
      chatDisabledAt: c.chatDisabledAt?.toISOString() ?? null,
    });
  }

  return {
    success: true,
    data: {
      jobId: job.id,
      chatDisabledAt: job.chatDisabledAt?.toISOString() ?? null,
      participants,
    },
  };
}

/** Turn this booking's chat thread off (or back on). */
export async function setJobChatDisabled(
  jobId: string,
  disabled: boolean
): Promise<Result<{ chatDisabledAt: string | null }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  if (typeof jobId !== "string" || !jobId) {
    return { success: false, error: "Job is required" };
  }

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobNumber: true, chatDisabledAt: true },
  });
  if (!job) return { success: false, error: "Job not found" };

  const next = disabled ? new Date() : null;
  // Already in the requested state — don't restamp the timestamp or log a
  // change that didn't happen.
  if (!!job.chatDisabledAt === disabled) {
    return {
      success: true,
      data: { chatDisabledAt: job.chatDisabledAt?.toISOString() ?? null },
    };
  }

  await db.job.update({ where: { id: jobId }, data: { chatDisabledAt: next } });

  await logActivity({
    category: "ADMIN",
    action: disabled ? "jobChat.disable" : "jobChat.enable",
    actorId: guard.userId,
    targetType: "job",
    targetId: jobId,
    message: `Job chat ${disabled ? "disabled" : "re-enabled"} for booking #${job.jobNumber}`,
    metadata: { jobNumber: job.jobNumber, disabled },
  });

  revalidatePath(`/admin/jobs/${jobId}`);
  return { success: true, data: { chatDisabledAt: next?.toISOString() ?? null } };
}

/**
 * Block (or unblock) one participant across every booking they are on.
 *
 * `kind` decides which table is written — a Client id and a User id are not
 * interchangeable, and accepting a bare id plus a table name from the browser
 * would let an admin flip an arbitrary row. Both are re-read before the write.
 */
export async function setParticipantChatDisabled(input: {
  kind: "client" | "cleaner";
  id: string;
  disabled: boolean;
  /** Refreshed after the write; the panel lives on the job page. */
  jobId?: string;
}): Promise<Result<{ chatDisabledAt: string | null }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const { kind, id, disabled } = input ?? {};
  if (kind !== "client" && kind !== "cleaner") {
    return { success: false, error: "Unknown participant" };
  }
  if (typeof id !== "string" || !id) {
    return { success: false, error: "Participant is required" };
  }

  const next = disabled ? new Date() : null;

  if (kind === "client") {
    const client = await db.client.findUnique({
      where: { id },
      select: { id: true, name: true, chatDisabledAt: true },
    });
    if (!client) return { success: false, error: "Customer not found" };
    if (!!client.chatDisabledAt === disabled) {
      return {
        success: true,
        data: { chatDisabledAt: client.chatDisabledAt?.toISOString() ?? null },
      };
    }
    await db.client.update({ where: { id }, data: { chatDisabledAt: next } });
    await logActivity({
      category: "ADMIN",
      action: disabled ? "jobChat.blockClient" : "jobChat.unblockClient",
      actorId: guard.userId,
      targetType: "client",
      targetId: id,
      message: `${client.name} ${disabled ? "blocked from" : "allowed back into"} job chat on all bookings`,
      metadata: { disabled },
    });
  } else {
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, chatDisabledAt: true },
    });
    if (!user) return { success: false, error: "Cleaner not found" };
    if (!!user.chatDisabledAt === disabled) {
      return {
        success: true,
        data: { chatDisabledAt: user.chatDisabledAt?.toISOString() ?? null },
      };
    }
    await db.user.update({ where: { id }, data: { chatDisabledAt: next } });
    await logActivity({
      category: "ADMIN",
      action: disabled ? "jobChat.blockCleaner" : "jobChat.unblockCleaner",
      actorId: guard.userId,
      targetType: "user",
      targetId: id,
      message: `${user.name} ${disabled ? "blocked from" : "allowed back into"} job chat on all jobs`,
      metadata: { disabled },
    });
  }

  if (input.jobId) revalidatePath(`/admin/jobs/${input.jobId}`);
  return { success: true, data: { chatDisabledAt: next?.toISOString() ?? null } };
}

/* ── Hide / restore a single message (CLN-P0-3-17) ─────────────────────────── */

/**
 * Hide one message from the cleaner and the client, preserving the original.
 *
 * Nothing about the row's content is touched: `body` and `attachmentUrl` are
 * left exactly as sent, and only `hiddenAt`/`hiddenById` are stamped. The
 * original text is additionally copied into the ActivityLog row, because
 * ActivityLog carries no FK to Job and therefore survives the
 * permanentlyDeleteJobs cascade that would otherwise take the conversation with
 * the booking — see the cascade question in the Stage 5 design note.
 */
export async function hideJobChatMessage(
  messageId: string
): Promise<Result<{ id: string; hiddenAt: string | null }>> {
  return setMessageHidden(messageId, true);
}

/** Put a hidden message back in front of the cleaner and the client. */
export async function unhideJobChatMessage(
  messageId: string
): Promise<Result<{ id: string; hiddenAt: string | null }>> {
  return setMessageHidden(messageId, false);
}

async function setMessageHidden(
  messageId: string,
  hidden: boolean
): Promise<Result<{ id: string; hiddenAt: string | null }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  if (typeof messageId !== "string" || !messageId) {
    return { success: false, error: "Message is required" };
  }

  const message = await db.jobChatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      jobId: true,
      body: true,
      attachmentUrl: true,
      senderRole: true,
      senderName: true,
      senderId: true,
      createdAt: true,
      hiddenAt: true,
      job: { select: { jobNumber: true } },
    },
  });
  if (!message) return { success: false, error: "Message not found" };

  // Already in the requested state — don't restamp or log a non-change.
  if (!!message.hiddenAt === hidden) {
    return {
      success: true,
      data: { id: messageId, hiddenAt: message.hiddenAt?.toISOString() ?? null },
    };
  }

  const now = hidden ? new Date() : null;
  await db.jobChatMessage.update({
    where: { id: messageId },
    // Only the moderation columns. The message itself is evidence.
    data: { hiddenAt: now, hiddenById: hidden ? guard.userId : null },
  });

  await logActivity({
    category: "ADMIN",
    action: hidden ? "jobChat.hideMessage" : "jobChat.unhideMessage",
    actorId: guard.userId,
    targetType: "jobChatMessage",
    targetId: messageId,
    message: `Chat message from ${message.senderName} on booking #${message.job?.jobNumber ?? "?"} ${hidden ? "hidden" : "restored"}`,
    metadata: {
      jobId: message.jobId,
      jobNumber: message.job?.jobNumber ?? null,
      senderRole: message.senderRole,
      senderName: message.senderName,
      senderId: message.senderId,
      sentAt: message.createdAt.toISOString(),
      // The preserved original. Survives even a permanent job delete.
      originalBody: message.body,
      originalAttachmentUrl: message.attachmentUrl,
    },
  });

  revalidatePath(`/admin/jobs/${message.jobId}`);
  return { success: true, data: { id: messageId, hiddenAt: now?.toISOString() ?? null } };
}
