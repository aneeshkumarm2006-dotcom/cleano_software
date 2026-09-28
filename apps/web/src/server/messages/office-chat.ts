// A correspondent's own conversation with the office: the cleaner's side of
// office chat (messages.ts, "Office chat").
//
// Who the office is, and who writes to it, is security batch 2's line
// (app/admin/chat/actions.ts): the office is OWNER and ADMIN; everyone else on
// staff, a FIELD_LEAD or OPS_MANAGER included, has one conversation of their
// own and posts in it as EMPLOYEE. This service only ever acts on the CALLER's
// own conversation, found by their user id; no conversation id comes in, and
// the sender's side is fixed to EMPLOYEE here, never derived from the role.
//
// The office's inbox (listing, reading and replying to everyone's
// conversations) is deliberately NOT here, and must not reuse the web's
// inbox helpers either; see manager-messages.ts.
import "server-only";

import { Prisma } from "@prisma/client";
import type { OfficeMessage } from "@bookmops/api/v1";

import { notifyChatEmail } from "@/app/admin/chat/notifyChatEmail";
import { currentOrgSlug } from "@/lib/asset-folder";
import { shortName } from "@/lib/avatar";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { officeChatPush } from "../push/notify";
import { failure, ok, type Result } from "../result";
import { decodeCursor, NEWEST_FIRST, olderThan, pageOf } from "./cursor";
import { isSendersChatAsset } from "./stored-url";

/** The web's presence rule: someone active in the last minute. */
export const PRESENCE_WINDOW_MS = 60_000;

/**
 * Who counts as "the office is online" for the dot and for delivery. The
 * web's list, unchanged (the security batch kept the cleaner's online dot as
 * it was), minus the caller: a field lead who is online themselves is not
 * the office being online.
 */
const PRESENCE_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] as const;

export const MESSAGE_BODY_MAX = 4000;
const PAGE_SIZE = 30;

export const MESSAGE_EMPTY = "Message cannot be empty";
export const MESSAGE_TOO_LONG = "Message is too long (max 4000 characters)";

async function officeOnline(actor: Actor, now: Date): Promise<boolean> {
  const present = await db.user.findFirst({
    where: {
      role: { in: [...PRESENCE_ROLES] },
      id: { not: actor.userId },
      isActive: true,
      deletedAt: null,
      lastSeenAt: { gte: new Date(now.getTime() - PRESENCE_WINDOW_MS) },
    },
    select: { id: true },
  });
  return !!present;
}

async function ownConversation(actor: Actor) {
  return db.chatConversation.findUnique({ where: { employeeId: actor.userId }, select: { id: true } });
}

/** Found or created by the caller's user id; race-safe on the unique employeeId. */
export async function ensureOwnConversation(actor: Actor): Promise<{ id: string }> {
  const existing = await ownConversation(actor);
  if (existing) return existing;
  try {
    return await db.chatConversation.create({ data: { employeeId: actor.userId }, select: { id: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await ownConversation(actor);
      if (row) return row;
    }
    throw e;
  }
}

export type OfficeMessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: "EMPLOYEE" | "ADMIN";
  body: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  attachmentName: string | null;
  clientEventId: string | null;
  createdAt: Date;
  readByAdminAt: Date | null;
  readByEmployeeAt: Date | null;
  deliveredAt: Date | null;
  sender: { name: string };
};

const ROW_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  senderRole: true,
  body: true,
  attachmentUrl: true,
  attachmentType: true,
  attachmentName: true,
  clientEventId: true,
  createdAt: true,
  readByAdminAt: true,
  readByEmployeeAt: true,
  deliveredAt: true,
  sender: { select: { name: true } },
} as const;

/** The wire shape, read from the correspondent's side. */
export function toOfficeMessage(m: OfficeMessageRow, actor: Actor, orgSlug: string): OfficeMessage {
  const fromMe = m.senderId === actor.userId;
  // Receipt from the sender's side, as the web's toMessageDTO.
  let receipt: "SENT" | "DELIVERED" | "READ" = "SENT";
  const readByOther = m.senderRole === "ADMIN" ? m.readByEmployeeAt : m.readByAdminAt;
  if (readByOther) receipt = "READ";
  else if (m.deliveredAt) receipt = "DELIVERED";

  const attachment =
    m.attachmentUrl && isSendersChatAsset(m.attachmentUrl, orgSlug, m.senderId)
      ? {
          kind: m.attachmentType === "image" ? ("IMAGE" as const) : ("FILE" as const),
          url: m.attachmentUrl,
          name: m.attachmentName,
        }
      : null;

  return {
    id: m.id,
    // Only the caller's own, so nobody learns another device's ids.
    clientEventId: fromMe ? m.clientEventId : null,
    fromMe,
    senderRole: m.senderRole,
    senderName: shortName(m.sender.name) || "Unknown",
    body: m.body,
    attachment,
    createdAt: m.createdAt.toISOString(),
    receipt,
  };
}

async function unreadFromOffice(conversationId: string): Promise<number> {
  return db.chatMessage.count({
    where: { conversationId, senderRole: "ADMIN", readByEmployeeAt: null },
  });
}

/** GET /chat: presence and unread. Marks nothing read, creates nothing. */
export async function officeChatSummary(
  actor: Actor,
  now: Date,
): Promise<Result<{ officeOnline: boolean; unreadCount: number }>> {
  const [conversation, online] = await Promise.all([ownConversation(actor), officeOnline(actor, now)]);
  return ok({ officeOnline: online, unreadCount: conversation ? await unreadFromOffice(conversation.id) : 0 });
}

/** GET /chat/messages: the caller's own conversation, newest first. */
export async function listOfficeMessages(
  actor: Actor,
  cursorRaw: string | undefined,
): Promise<Result<{ items: OfficeMessage[]; nextCursor: string | null }>> {
  const cursor = decodeCursor(cursorRaw);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");
  const conversation = await ownConversation(actor);
  if (!conversation) return ok({ items: [], nextCursor: null });
  const rows = await db.chatMessage.findMany({
    where: { conversationId: conversation.id, ...olderThan(cursor) },
    orderBy: NEWEST_FIRST,
    take: PAGE_SIZE + 1,
    select: ROW_SELECT,
  });
  const page = pageOf(rows as OfficeMessageRow[], PAGE_SIZE);
  const slug = await currentOrgSlug();
  return ok({ items: page.rows.map((m) => toOfficeMessage(m, actor, slug)), nextCursor: page.nextCursor });
}

export interface SendOfficeInput {
  body: string;
  /** The phone's id for this tap; v1 only. */
  clientEventId?: string | null;
  /** The web's uploader result; v1 sends none. */
  attachment?: { url: string; type: string; name: string } | null;
  now: Date;
}

/**
 * Post in the caller's OWN conversation as EMPLOYEE. Keeps sendChatMessage's
 * side effects: delivered at once when the office is online; otherwise the
 * throttled email to the office, as an effect (the v1 wrapper runs it after
 * the response, and never for a replay).
 */
export async function sendOfficeMessage(
  actor: Actor,
  input: SendOfficeInput,
): Promise<Result<{ message: OfficeMessage; row: OfficeMessageRow }>> {
  const trimmed = input.body.trim();
  if (!trimmed && !input.attachment) return failure(400, "VALIDATION_FAILED", MESSAGE_EMPTY);
  if (trimmed.length > MESSAGE_BODY_MAX) return failure(400, "VALIDATION_FAILED", MESSAGE_TOO_LONG);

  const slug = await currentOrgSlug();
  if (input.attachment && !isSendersChatAsset(input.attachment.url, slug, actor.userId)) {
    return failure(400, "VALIDATION_FAILED", "That attachment couldn't be sent. Upload it again.");
  }

  const conversation = await ensureOwnConversation(actor);
  const now = input.now;

  // A retry whose idempotency record has expired: the message is already
  // there, so it is returned as it is, with no second email.
  if (input.clientEventId) {
    const existing = await db.chatMessage.findFirst({
      where: { senderId: actor.userId, clientEventId: input.clientEventId },
      select: ROW_SELECT,
    });
    if (existing) {
      const row = existing as OfficeMessageRow;
      return ok({ message: toOfficeMessage(row, actor, slug), row });
    }
  }

  const recipientOnline = await officeOnline(actor, now);

  let created: OfficeMessageRow;
  try {
    created = (await db.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.userId,
          senderRole: "EMPLOYEE",
          body: trimmed,
          attachmentUrl: input.attachment?.url ?? null,
          attachmentType: input.attachment?.type ?? null,
          attachmentName: input.attachment?.name ?? null,
          clientEventId: input.clientEventId ?? null,
          readByEmployeeAt: now,
          deliveredAt: recipientOnline ? now : null,
          createdAt: now,
        },
        select: ROW_SELECT,
      });
      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastEmployeeMessageAt: now },
      });
      return m;
    })) as OfficeMessageRow;
  } catch (e) {
    if (input.clientEventId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await db.chatMessage.findFirst({
        where: { senderId: actor.userId, clientEventId: input.clientEventId },
        select: ROW_SELECT,
      });
      if (existing) {
        const row = existing as OfficeMessageRow;
        return ok({ message: toOfficeMessage(row, actor, slug), row });
      }
    }
    throw e;
  }

  const effects: Effect[] = [
    effect("office chat email", () =>
      notifyChatEmail({
        conversationId: conversation.id,
        senderRole: "EMPLOYEE",
        senderName: actor.name ?? "A cleaner",
        body: trimmed,
        recipientOnline,
      }),
    ),
    officeChatPush(actor.userId, actor.name),
  ];
  return ok({ message: toOfficeMessage(created, actor, slug), row: created }, effects);
}

/** POST /chat/read: stamps the office's messages in the caller's OWN conversation. */
export async function markOfficeRead(actor: Actor, now: Date): Promise<Result<{ unreadCount: number }>> {
  const conversation = await ownConversation(actor);
  if (!conversation) return ok({ unreadCount: 0 });
  await db.chatMessage.updateMany({
    where: { conversationId: conversation.id, senderRole: "ADMIN", readByEmployeeAt: null },
    data: { readByEmployeeAt: now },
  });
  return ok({ unreadCount: await unreadFromOffice(conversation.id) });
}

/** The web's own-conversation id check, for the actions that still take one. */
export async function isOwnConversation(actor: Actor, conversationId: string): Promise<"yes" | "no" | "missing"> {
  const c = await db.chatConversation.findUnique({ where: { id: conversationId }, select: { employeeId: true } });
  if (!c) return "missing";
  return c.employeeId === actor.userId ? "yes" : "no";
}
