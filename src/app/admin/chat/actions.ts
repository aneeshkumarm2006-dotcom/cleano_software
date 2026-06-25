"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { cloudinary } from "@/lib/cloudinary";
import type { UploadApiResponse } from "cloudinary";
import type {
  AdminChatPayload,
  AdminConversationSummary,
  ChatMessageDTO,
  EmployeeChatPayload,
} from "./types";
import { notifyChatEmail } from "./notifyChatEmail";

type SessionUser = { id: string; name: string; role?: string };
type AppRole = "OWNER" | "ADMIN" | "OPS_MANAGER" | "FIELD_LEAD" | "EMPLOYEE";

type RequireUserResult =
  | { error: string }
  | { user: SessionUser; role: AppRole };

async function requireUser(): Promise<RequireUserResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const user = session.user as SessionUser;
  return {
    user,
    role: (user.role as AppRole | undefined) ?? "EMPLOYEE",
  };
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

type RawMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: "EMPLOYEE" | "ADMIN";
  body: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  attachmentName: string | null;
  createdAt: Date;
  readByAdminAt: Date | null;
  readByEmployeeAt: Date | null;
  deliveredAt: Date | null;
  sender: { name: string };
};

const PRESENCE_WINDOW_MS = 60_000;

function isOnline(lastSeenAt: Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() < PRESENCE_WINDOW_MS;
}

function toMessageDTO(m: RawMessage, viewerIsAdmin: boolean): ChatMessageDTO {
  // Receipt state, from the perspective of the message's *sender*.
  // - READ: the other side has opened it
  // - DELIVERED: marked delivered (recipient pinged after send)
  // - SENT: still waiting
  let receipt: "SENT" | "DELIVERED" | "READ" = "SENT";
  if (m.senderRole === "ADMIN") {
    if (m.readByEmployeeAt) receipt = "READ";
    else if (m.deliveredAt) receipt = "DELIVERED";
  } else {
    if (m.readByAdminAt) receipt = "READ";
    else if (m.deliveredAt) receipt = "DELIVERED";
  }
  // viewerIsAdmin is intentionally consumed so the type matches; the
  // bubble renders the receipt only on messages it owns.
  void viewerIsAdmin;

  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: m.sender.name,
    senderRole: m.senderRole,
    body: m.body,
    attachmentUrl: m.attachmentUrl,
    attachmentType: m.attachmentType,
    attachmentName: m.attachmentName,
    createdAt: m.createdAt.toISOString(),
    readByAdminAt: m.readByAdminAt ? m.readByAdminAt.toISOString() : null,
    readByEmployeeAt: m.readByEmployeeAt ? m.readByEmployeeAt.toISOString() : null,
    deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
    receipt,
  };
}

async function findOrCreateConversationForEmployee(employeeId: string) {
  const existing = await db.chatConversation.findUnique({
    where: { employeeId },
  });
  if (existing) return existing;
  return db.chatConversation.create({ data: { employeeId } });
}

export async function getEmployeeChat(): Promise<
  { success: true; data: EmployeeChatPayload } | { success: false; error: string }
> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };

  const conversation = await findOrCreateConversationForEmployee(a.user.id);

  // Mark admin-sent messages as read & delivered by this employee.
  const now = new Date();
  await db.chatMessage.updateMany({
    where: {
      conversationId: conversation.id,
      senderRole: "ADMIN",
      readByEmployeeAt: null,
    },
    data: { readByEmployeeAt: now, deliveredAt: now },
  });

  const messages = await db.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { name: true } } },
  });

  // "Other side online" = any admin pinged within window. We approximate by
  // looking at any admin-role user's lastSeenAt.
  const recentAdmin = await db.user.findFirst({
    where: {
      role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] },
      lastSeenAt: { gte: new Date(Date.now() - PRESENCE_WINDOW_MS) },
    },
    select: { id: true },
  });

  return {
    success: true,
    data: {
      conversationId: conversation.id,
      messages: messages.map((m) => toMessageDTO(m, false)),
      otherOnline: !!recentAdmin,
    },
  };
}

export async function getAdminChatList(): Promise<
  { success: true; data: AdminConversationSummary[] } | { success: false; error: string }
> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  // Make sure every employee has a conversation row so the list isn't empty
  // before the first message is sent. Idempotent.
  const employees = await db.user.findMany({
    where: { role: "EMPLOYEE" },
    select: { id: true, name: true, image: true },
  });

  const existing = await db.chatConversation.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) } },
    select: { employeeId: true },
  });
  const existingIds = new Set(existing.map((e) => e.employeeId));
  const missing = employees.filter((e) => !existingIds.has(e.id));
  if (missing.length > 0) {
    await db.chatConversation.createMany({
      data: missing.map((e) => ({ employeeId: e.id })),
      skipDuplicates: true,
    });
  }

  const conversations = await db.chatConversation.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) } },
    include: {
      employee: { select: { id: true, name: true, image: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          body: true,
          createdAt: true,
          senderRole: true,
        },
      },
    },
  });

  // Unread count per conversation: employee-sent messages not yet read by admin.
  const unreadCounts = await db.chatMessage.groupBy({
    by: ["conversationId"],
    where: {
      conversationId: { in: conversations.map((c) => c.id) },
      senderRole: "EMPLOYEE",
      readByAdminAt: null,
    },
    _count: { _all: true },
  });
  const unreadMap = new Map<string, number>();
  for (const u of unreadCounts) unreadMap.set(u.conversationId, u._count._all);

  const summaries: AdminConversationSummary[] = conversations.map((c) => {
    const last = c.messages[0];
    return {
      conversationId: c.id,
      employeeId: c.employee.id,
      employeeName: c.employee.name,
      employeeImage: c.employee.image,
      lastMessageBody: last?.body ?? null,
      lastMessageAt: last ? last.createdAt.toISOString() : null,
      lastSenderRole: last ? last.senderRole : null,
      unreadFromEmployee: unreadMap.get(c.id) ?? 0,
    };
  });

  // Sort: unread first, then by lastMessageAt desc, then alphabetic.
  summaries.sort((a, b) => {
    if (a.unreadFromEmployee !== b.unreadFromEmployee) {
      return b.unreadFromEmployee - a.unreadFromEmployee;
    }
    if (a.lastMessageAt && b.lastMessageAt) {
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    }
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.employeeName.localeCompare(b.employeeName);
  });

  return { success: true, data: summaries };
}

export async function getAdminChat(
  employeeId: string
): Promise<{ success: true; data: AdminChatPayload } | { success: false; error: string }> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };
  if (!isAdminRole(a.role)) return { success: false, error: "Not authorized" };

  const employee = await db.user.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, image: true, role: true, lastSeenAt: true },
  });
  if (!employee || isAdminRole(employee.role) || employee.role === "CLIENT") {
    return { success: false, error: "Employee not found" };
  }

  const conversation = await findOrCreateConversationForEmployee(employee.id);

  // Mark employee-sent messages as read & delivered by admin.
  const now = new Date();
  await db.chatMessage.updateMany({
    where: {
      conversationId: conversation.id,
      senderRole: "EMPLOYEE",
      readByAdminAt: null,
    },
    data: { readByAdminAt: now, deliveredAt: now },
  });

  const messages = await db.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { name: true } } },
  });

  return {
    success: true,
    data: {
      conversationId: conversation.id,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeImage: employee.image,
      messages: messages.map((m) => toMessageDTO(m, true)),
      otherOnline: isOnline(employee.lastSeenAt),
    },
  };
}

interface ChatAttachmentInput {
  url: string;
  type: string;
  name: string;
}

export async function sendChatMessage(
  conversationId: string,
  body: string,
  attachment?: ChatAttachmentInput | null
): Promise<{ success: true; data: ChatMessageDTO } | { success: false; error: string }> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };

  const trimmed = body.trim();
  // A message must have text or an attachment.
  if (!trimmed && !attachment) {
    return { success: false, error: "Message cannot be empty" };
  }
  if (trimmed.length > 4000) {
    return { success: false, error: "Message is too long (max 4000 characters)" };
  }

  const conversation = await db.chatConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return { success: false, error: "Conversation not found" };

  const senderRole: "EMPLOYEE" | "ADMIN" = isAdminRole(a.role) ? "ADMIN" : "EMPLOYEE";

  // An employee can only post in their own conversation.
  if (senderRole === "EMPLOYEE" && conversation.employeeId !== a.user.id) {
    return { success: false, error: "Not authorized" };
  }

  const now = new Date();

  // Is the recipient online right now? Used to immediately set deliveredAt
  // (gives ✓✓) and also to gate the email notification (only email when
  // they're not active).
  let recipientOnline = false;
  if (senderRole === "EMPLOYEE") {
    const adminPresent = await db.user.findFirst({
      where: {
        role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] },
        lastSeenAt: { gte: new Date(Date.now() - PRESENCE_WINDOW_MS) },
      },
      select: { id: true },
    });
    recipientOnline = !!adminPresent;
  } else {
    const emp = await db.user.findUnique({
      where: { id: conversation.employeeId },
      select: { lastSeenAt: true },
    });
    recipientOnline = isOnline(emp?.lastSeenAt);
  }

  const message = await db.chatMessage.create({
    data: {
      conversationId,
      senderId: a.user.id,
      senderRole,
      body: trimmed,
      attachmentUrl: attachment?.url ?? null,
      attachmentType: attachment?.type ?? null,
      attachmentName: attachment?.name ?? null,
      readByAdminAt: senderRole === "ADMIN" ? now : null,
      readByEmployeeAt: senderRole === "EMPLOYEE" ? now : null,
      deliveredAt: recipientOnline ? now : null,
    },
    include: { sender: { select: { name: true } } },
  });

  await db.chatConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: now,
      ...(senderRole === "EMPLOYEE"
        ? { lastEmployeeMessageAt: now }
        : { lastAdminMessageAt: now }),
    },
  });

  // Fire-and-forget email notification (respects admin's notification toggles).
  notifyChatEmail({
    conversationId,
    senderRole,
    senderName: a.user.name,
    body: trimmed,
    recipientOnline,
  }).catch((err) => console.error("notifyChatEmail failed", err));

  return { success: true, data: toMessageDTO(message, isAdminRole(a.role)) };
}

export async function getUnreadChatCount(): Promise<{
  count: number;
  latest?: { senderName: string; body: string; at: string };
}> {
  try {
    const a = await requireUser();
    if ("error" in a) return { count: 0 };

    if (isAdminRole(a.role)) {
      const count = await db.chatMessage.count({
        where: { senderRole: "EMPLOYEE", readByAdminAt: null },
      });
      const latest = count > 0
        ? await db.chatMessage.findFirst({
            where: { senderRole: "EMPLOYEE", readByAdminAt: null },
            orderBy: { createdAt: "desc" },
            include: { sender: { select: { name: true } } },
          })
        : null;
      return {
        count,
        latest: latest
          ? { senderName: latest.sender.name, body: latest.body, at: latest.createdAt.toISOString() }
          : undefined,
      };
    } else {
      const conversation = await db.chatConversation.findUnique({
        where: { employeeId: a.user.id },
      });
      if (!conversation) return { count: 0 };

      const count = await db.chatMessage.count({
        where: { conversationId: conversation.id, senderRole: "ADMIN", readByEmployeeAt: null },
      });
      const latest = count > 0
        ? await db.chatMessage.findFirst({
            where: { conversationId: conversation.id, senderRole: "ADMIN", readByEmployeeAt: null },
            orderBy: { createdAt: "desc" },
            include: { sender: { select: { name: true } } },
          })
        : null;
      return {
        count,
        latest: latest
          ? { senderName: latest.sender.name, body: latest.body, at: latest.createdAt.toISOString() }
          : undefined,
      };
    }
  } catch {
    return { count: 0 };
  }
}

export async function markChatRead(
  conversationId: string
): Promise<{ success: true } | { success: false; error: string }> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };

  const conversation = await db.chatConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return { success: false, error: "Conversation not found" };

  const now = new Date();

  if (isAdminRole(a.role)) {
    await db.chatMessage.updateMany({
      where: {
        conversationId,
        senderRole: "EMPLOYEE",
        readByAdminAt: null,
      },
      data: { readByAdminAt: now },
    });
  } else {
    if (conversation.employeeId !== a.user.id) {
      return { success: false, error: "Not authorized" };
    }
    await db.chatMessage.updateMany({
      where: {
        conversationId,
        senderRole: "ADMIN",
        readByEmployeeAt: null,
      },
      data: { readByEmployeeAt: now },
    });
  }

  return { success: true };
}

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "application/pdf",
];

function streamUploadAttachment(
  buffer: Buffer,
  folder: string,
  publicId: string
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: "auto", // allow images and documents (PDF)
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) reject(error || new Error("Upload failed"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

export async function uploadChatAttachment(formData: FormData): Promise<
  | { success: true; url: string; type: "image" | "file"; name: string }
  | { success: false; error: string }
> {
  const a = await requireUser();
  if ("error" in a) return { success: false, error: a.error };

  const file = formData.get("file") as File | null;
  if (!file || typeof file === "string") {
    return { success: false, error: "No file provided" };
  }
  if (file.size === 0) return { success: false, error: "Empty file" };
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return { success: false, error: "File exceeds 10MB limit" };
  }
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type.toLowerCase())) {
    return {
      success: false,
      error: "Unsupported file type. Use an image or PDF.",
    };
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return { success: false, error: "Cloudinary is not configured on the server" };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const folder = `cleano/chat/${a.user.id}`;
    const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const result = await streamUploadAttachment(buffer, folder, publicId);
    const isImage = file.type.toLowerCase().startsWith("image/");

    return {
      success: true,
      url: result.secure_url,
      type: isImage ? "image" : "file",
      name: file.name,
    };
  } catch (error: any) {
    console.error("Error uploading chat attachment:", error);
    const detail =
      error?.message ?? error?.error?.message ?? String(error ?? "unknown");
    return { success: false, error: `Upload failed: ${detail}` };
  }
}
