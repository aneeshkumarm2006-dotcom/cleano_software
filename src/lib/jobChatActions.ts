"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { smsJobChatMessage } from "@/lib/sms";

// ── Types ────────────────────────────────────────────────────────────────────

export type JobChatRole = "CLEANER" | "CLIENT" | "ADMIN";

export interface JobChatMessageDTO {
  id: string;
  jobId: string;
  senderId: string | null;
  senderRole: JobChatRole;
  senderName: string;
  body: string;
  createdAt: string;
  /** True when this message was sent by the current viewer. */
  mine: boolean;
}

export interface JobChatPayload {
  jobId: string;
  /** Viewer's own role in this thread. */
  viewerRole: JobChatRole;
  messages: JobChatMessageDTO[];
}

// Must match ADMIN_ROLES in src/lib/role-routing.ts
function isAdminRole(role: string | undefined) {
  return (
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "OPS_MANAGER" ||
    role === "FIELD_LEAD"
  );
}

type SessionUser = { id: string; name: string; email?: string; role?: string };

type Participant = {
  user: SessionUser;
  role: JobChatRole;
};

/**
 * Resolve the current session against a job and decide the caller's role in the
 * job's chat thread. Returns an error string if the caller is not a participant
 * (not the assigned cleaner/lead, not the job's client, and not an admin).
 */
async function resolveParticipant(
  jobId: string
): Promise<{ participant: Participant } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const user = session.user as SessionUser;

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      employeeId: true,
      clientId: true,
      cleaners: { select: { id: true } },
    },
  });
  if (!job) return { error: "Job not found" };

  // 1) Cleaner — the job's employee lead or any assigned cleaner.
  const isCleaner =
    job.employeeId === user.id || job.cleaners.some((c) => c.id === user.id);
  if (isCleaner) return { participant: { user, role: "CLEANER" } };

  // 2) Client — the customer that owns this job. Job.clientId points at a
  //    Client record; the portal session is a User, so match by email.
  if (job.clientId) {
    const email = user.email?.toLowerCase();
    if (email) {
      const client = await db.client.findFirst({
        where: { email },
        select: { id: true, name: true },
      });
      if (client && client.id === job.clientId) {
        return {
          participant: {
            user: { ...user, name: client.name ?? user.name },
            role: "CLIENT",
          },
        };
      }
    }
  }

  // 3) Admin — OWNER/ADMIN/OPS_MANAGER/FIELD_LEAD may view and post.
  if (isAdminRole(user.role)) {
    return { participant: { user, role: "ADMIN" } };
  }

  return { error: "Not authorized" };
}

function toDTO(
  m: {
    id: string;
    jobId: string;
    senderId: string | null;
    senderRole: JobChatRole;
    senderName: string;
    body: string;
    createdAt: Date;
  },
  viewerRole: JobChatRole,
  viewerId: string
): JobChatMessageDTO {
  return {
    id: m.id,
    jobId: m.jobId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    senderName: m.senderName,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: m.senderRole === viewerRole && m.senderId === viewerId,
  };
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Load the chat thread for a job and mark everything the viewer hasn't seen as
 * read (for the viewer's role). Authorized to the assigned cleaner, the job's
 * client, or an admin.
 */
export async function getJobChatMessages(
  jobId: string
): Promise<{ success: true; data: JobChatPayload } | { success: false; error: string }> {
  const r = await resolveParticipant(jobId);
  if ("error" in r) return { success: false, error: r.error };
  const { user, role } = r.participant;

  // Mark incoming messages (from the other parties) as read for this role.
  const readField =
    role === "CLEANER"
      ? "readByCleanerAt"
      : role === "CLIENT"
        ? "readByClientAt"
        : "readByAdminAt";
  await db.jobChatMessage.updateMany({
    where: {
      jobId,
      senderRole: { not: role },
      [readField]: null,
    },
    data: { [readField]: new Date() },
  });

  const messages = await db.jobChatMessage.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      jobId: true,
      senderId: true,
      senderRole: true,
      senderName: true,
      body: true,
      createdAt: true,
    },
  });

  return {
    success: true,
    data: {
      jobId,
      viewerRole: role,
      messages: messages.map((m) => toDTO(m, role, user.id)),
    },
  };
}

/**
 * Post a message to a job's chat thread. Sender role is resolved from the
 * session against the job (cleaner / client / admin).
 */
export async function sendJobChatMessage(
  jobId: string,
  body: string
): Promise<{ success: true; data: JobChatMessageDTO } | { success: false; error: string }> {
  const r = await resolveParticipant(jobId);
  if ("error" in r) return { success: false, error: r.error };
  const { user, role } = r.participant;

  const trimmed = body.trim();
  if (!trimmed) return { success: false, error: "Message cannot be empty" };
  if (trimmed.length > 4000) {
    return { success: false, error: "Message is too long (max 4000 characters)" };
  }

  const now = new Date();
  const message = await db.jobChatMessage.create({
    data: {
      jobId,
      senderId: user.id,
      senderRole: role,
      senderName: user.name,
      body: trimmed,
      // The sender has, by definition, seen their own message.
      readByCleanerAt: role === "CLEANER" ? now : null,
      readByClientAt: role === "CLIENT" ? now : null,
      readByAdminAt: role === "ADMIN" ? now : null,
    },
    select: {
      id: true,
      jobId: true,
      senderId: true,
      senderRole: true,
      senderName: true,
      body: true,
      createdAt: true,
    },
  });

  // Outbound SMS bridge (#11): a cleaner/admin message is delivered to the
  // client by SMS via Twilio. No-op until Twilio env vars + the customer chat
  // SMS toggle are set (both gated inside sendSms). The client's number is
  // never exposed to the cleaner. Client-authored messages are not re-sent.
  if (role === "CLEANER" || role === "ADMIN") {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: { jobNumber: true, client: { select: { phone: true } } },
    });
    const phone = job?.client?.phone;
    if (phone) {
      smsJobChatMessage({
        to: phone,
        jobNumber: job!.jobNumber,
        senderLabel: role === "CLEANER" ? "your cleaner" : "Cleano",
        body: trimmed,
      }).catch((e) => console.error("job chat outbound sms", e));
    }
  }

  return { success: true, data: toDTO(message, role, user.id) };
}
