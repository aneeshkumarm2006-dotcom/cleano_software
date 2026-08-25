"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { smsJobChatMessage } from "@/lib/sms";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";

// ── Types ────────────────────────────────────────────────────────────────────

export type JobChatRole = "CLEANER" | "CLIENT" | "ADMIN";

export interface JobChatMessageDTO {
  id: string;
  jobId: string;
  senderId: string | null;
  senderRole: JobChatRole;
  senderName: string;
  body: string;
  /** Photo attached to this message, or null for a text-only message. */
  attachmentUrl: string | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
  createdAt: string;
  /** True when this message was sent by the current viewer. */
  mine: boolean;
  /**
   * Hidden by an admin (CLN-P0-3-17). Only ever true on an admin's copy of the
   * thread — a cleaner or client never receives the row at all, so this cannot
   * leak a moderated message to the browser it was hidden from.
   */
  hidden: boolean;
  hiddenAt: string | null;
}

export interface JobChatPayload {
  jobId: string;
  /** Viewer's own role in this thread. */
  viewerRole: JobChatRole;
  messages: JobChatMessageDTO[];
  /**
   * Messaging is switched off for this viewer (CLN-P0-3-14) — the composer
   * must be withdrawn. The thread itself stays readable: 3-10 and 3-15 require
   * the record to survive, so "disabled" means read-only, never invisible.
   */
  messagingDisabled: boolean;
  /** Shown in place of the composer. Null when messaging is allowed. */
  messagingDisabledReason: string | null;
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
  /** Null when this participant may post; otherwise why they may not. */
  postingBlockedReason: string | null;
};

const BLOCKED_BOOKING = "Messaging is turned off for this booking.";
const BLOCKED_PARTICIPANT = "Messaging has been turned off for your account.";

/**
 * Resolve the current session against a job and decide the caller's role in the
 * job's chat thread. Returns an error string if the caller is not a participant
 * (not the assigned cleaner/lead, not the job's client, and not an admin).
 *
 * Also resolves whether that participant may POST (CLN-P0-3-14). The job row,
 * the assigned cleaners' flags and the client's flag all come back in the one
 * query the function already made, so the check costs no extra round trip on a
 * thread that polls every 4 seconds.
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
      chatDisabledAt: true,
      employee: { select: { id: true, chatDisabledAt: true } },
      cleaners: { select: { id: true, chatDisabledAt: true } },
    },
  });
  if (!job) return { error: "Job not found" };

  const bookingBlocked = job.chatDisabledAt ? BLOCKED_BOOKING : null;

  // 1) Cleaner — the job's employee lead or any assigned cleaner.
  const cleanerRow =
    (job.employee?.id === user.id ? job.employee : null) ??
    job.cleaners.find((c) => c.id === user.id) ??
    null;
  if (cleanerRow || job.employeeId === user.id) {
    return {
      participant: {
        user,
        role: "CLEANER",
        postingBlockedReason:
          bookingBlocked ??
          (cleanerRow?.chatDisabledAt ? BLOCKED_PARTICIPANT : null),
      },
    };
  }

  // 2) Client — the customer that owns this job. Job.clientId points at a
  //    Client record; the portal session is a User, so match by email.
  if (job.clientId) {
    const email = user.email?.toLowerCase();
    if (email) {
      const client = await db.client.findFirst({
        where: { email },
        select: { id: true, name: true, chatDisabledAt: true },
      });
      if (client && client.id === job.clientId) {
        return {
          participant: {
            user: { ...user, name: client.name ?? user.name },
            role: "CLIENT",
            postingBlockedReason:
              bookingBlocked ??
              (client.chatDisabledAt ? BLOCKED_PARTICIPANT : null),
          },
        };
      }
    }
  }

  // 3) Admin — OWNER/ADMIN/OPS_MANAGER/FIELD_LEAD may view and post. Admins are
  //    exempt from the disable: moderation is the reason the switch exists, and
  //    someone has to be able to say why the thread was closed.
  if (isAdminRole(user.role)) {
    return { participant: { user, role: "ADMIN", postingBlockedReason: null } };
  }

  return { error: "Not authorized" };
}

/**
 * Server-side messaging gate for a client-supplied client/job pair, for callers
 * that have no session — today the Twilio inbound webhook, which appends an
 * SMS reply as a CLIENT message. Without this, a blocked customer simply texts
 * instead and the disable is decorative.
 */
export async function isJobChatOpenForClient(
  jobId: string,
  clientId: string
): Promise<boolean> {
  try {
    const [job, client] = await Promise.all([
      db.job.findUnique({ where: { id: jobId }, select: { chatDisabledAt: true } }),
      db.client.findUnique({ where: { id: clientId }, select: { chatDisabledAt: true } }),
    ]);
    // Both rows must exist: a job or customer that vanished between the
    // webhook's own lookup and this one is not a reason to let the write land.
    return !!job && !job.chatDisabledAt && !!client && !client.chatDisabledAt;
  } catch {
    // Fail closed: a lookup failure must not become a way past the block.
    return false;
  }
}

function toDTO(
  m: {
    id: string;
    jobId: string;
    senderId: string | null;
    senderRole: JobChatRole;
    senderName: string;
    body: string;
    attachmentUrl: string | null;
    attachmentWidth: number | null;
    attachmentHeight: number | null;
    hiddenAt: Date | null;
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
    attachmentUrl: m.attachmentUrl,
    attachmentWidth: m.attachmentWidth,
    attachmentHeight: m.attachmentHeight,
    createdAt: m.createdAt.toISOString(),
    mine: m.senderRole === viewerRole && m.senderId === viewerId,
    hidden: m.hiddenAt !== null,
    hiddenAt: m.hiddenAt?.toISOString() ?? null,
  };
}

/** Columns every read of a message returns — kept in one place so the DTO and
 *  the queries can't drift as the row grows. */
const MESSAGE_SELECT = {
  id: true,
  jobId: true,
  senderId: true,
  senderRole: true,
  senderName: true,
  body: true,
  attachmentUrl: true,
  attachmentWidth: true,
  attachmentHeight: true,
  hiddenAt: true,
  createdAt: true,
} as const;

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
  const { user, role, postingBlockedReason } = r.participant;

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
    // CLN-P0-3-17 — a moderated message is filtered out server-side for the
    // cleaner and the client, so it never reaches the browser it was hidden
    // from. An admin gets it, marked, because the point is to preserve the
    // original for disputes rather than to erase it.
    where: { jobId, ...(role === "ADMIN" ? {} : { hiddenAt: null }) },
    orderBy: { createdAt: "asc" },
    select: MESSAGE_SELECT,
  });

  return {
    success: true,
    data: {
      jobId,
      viewerRole: role,
      messages: messages.map((m) => toDTO(m, role, user.id)),
      messagingDisabled: postingBlockedReason !== null,
      messagingDisabledReason: postingBlockedReason,
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
  const { user, role, postingBlockedReason } = r.participant;
  // CLN-P0-3-14 — server-side, ahead of every write. Hiding the composer is a
  // convenience; this is the enforcement.
  if (postingBlockedReason) {
    return { success: false, error: postingBlockedReason };
  }

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
    select: MESSAGE_SELECT,
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

// ── Photo attachments (CLN-P0-3-05) ──────────────────────────────────────────

/** Matches uploadJobPhoto — one cap for every photo a phone sends us. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];

function streamUpload(
  buffer: Buffer,
  folder: string,
  publicId: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "image",
        overwrite: false,
        // A large HEIC on a cell connection needs far longer than the default.
        timeout: 90_000,
      },
      (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Post a photo (with an optional caption) to a job's chat thread.
 *
 * Authorization goes through the same `resolveParticipant` gate as a text
 * message — deliberately NOT through `uploadJobPhoto`, which admits admins and
 * assigned cleaners only. The client is a first-class participant here and is
 * absent from that list; reusing it would have let cleaners send photos and
 * silently refused the customer.
 *
 * The upload happens before the row is written, so a failed upload leaves no
 * empty message behind.
 */
export async function sendJobChatPhoto(
  formData: FormData
): Promise<{ success: true; data: JobChatMessageDTO } | { success: false; error: string }> {
  const jobId = formData.get("jobId");
  if (typeof jobId !== "string" || !jobId) {
    return { success: false, error: "Missing job" };
  }

  const r = await resolveParticipant(jobId);
  if ("error" in r) return { success: false, error: r.error };
  const { user, role, postingBlockedReason } = r.participant;
  // CLN-P0-3-14 — before the file is read, so a blocked participant can't even
  // spend an upload.
  if (postingBlockedReason) {
    return { success: false, error: postingBlockedReason };
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { success: false, error: "No photo provided" };
  }
  if (file.size === 0) return { success: false, error: "Empty file" };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { success: false, error: "Photo exceeds the 10MB limit" };
  }
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type.toLowerCase())) {
    return {
      success: false,
      error: "Unsupported file type. Use JPG, PNG, HEIC, or WebP.",
    };
  }

  const captionRaw = formData.get("body");
  const caption = typeof captionRaw === "string" ? captionRaw.trim() : "";
  if (caption.length > 4000) {
    return { success: false, error: "Message is too long (max 4000 characters)" };
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return { success: false, error: "Photo uploads are not configured on the server" };
  }

  let uploaded: UploadApiResponse;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    uploaded = await streamUpload(
      buffer,
      `cleano/job-chat/${jobId}`,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
  } catch (e) {
    console.error("job chat photo upload", e);
    return { success: false, error: "Failed to upload the photo" };
  }

  const now = new Date();
  const message = await db.jobChatMessage.create({
    data: {
      jobId,
      senderId: user.id,
      senderRole: role,
      senderName: user.name,
      // Photo-only messages store "" rather than making the column nullable.
      body: caption,
      attachmentUrl: uploaded.secure_url,
      attachmentWidth: uploaded.width ?? null,
      attachmentHeight: uploaded.height ?? null,
      readByCleanerAt: role === "CLEANER" ? now : null,
      readByClientAt: role === "CLIENT" ? now : null,
      readByAdminAt: role === "ADMIN" ? now : null,
    },
    select: MESSAGE_SELECT,
  });

  // Same outbound SMS bridge as a text message. The photo can't ride an SMS,
  // so the caption (or a stand-in) goes out and the photo waits in the portal.
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
        body: caption ? `${caption} (photo attached — open your booking to view)` : "Sent a photo — open your booking to view it.",
      }).catch((e) => console.error("job chat outbound sms", e));
    }
  }

  return { success: true, data: toDTO(message, role, user.id) };
}
