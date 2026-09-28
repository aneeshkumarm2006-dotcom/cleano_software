// The office's inbox: every correspondent's conversation with the office,
// read and answered AS the office (packages/api/src/v1/manager-messages.ts).
//
// Written for v1, and deliberately NOT over app/admin/chat/actions.ts: those
// pick the sender's side from the caller's role, and their list and open
// rules differ from this contract's. Here:
//   - the caller must have OFFICE_INBOX (OWNER, ADMIN): v1Route's gate, and
//     checked again below;
//   - the correspondent is the path's `:cleanerId`, looked up in the caller's
//     company among CORRESPONDENT_ROLES (EMPLOYEE, FIELD_LEAD, OPS_MANAGER:
//     everyone on staff who writes to the office as EMPLOYEE); anyone else,
//     or another company's person, is 404;
//   - the side is fixed by this module: every message posted here is
//     senderRole ADMIN, sent by the caller, and stamps readByAdminAt; marking
//     read stamps readByAdminAt on the correspondent's messages. Neither is
//     ever taken from the request or derived from the caller's role.
// Shared with the cleaner side is only the storage underneath: the message
// row and wire shape (server/messages/office-chat.ts) and the throttled
// notifyChatEmail, each told the side explicitly.
import "server-only";

import type { OfficeConversation, OfficeConversationsResponse, OfficeMessage } from "@bookmops/api/v1";
import { can } from "@bookmops/api/v1";
import { Prisma } from "@prisma/client";

import { notifyChatEmail } from "@/app/admin/chat/notifyChatEmail";
import { currentOrgSlug } from "@/lib/asset-folder";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect } from "../effects";
import { officeReplyPush } from "../push/notify";
import { failure, notFound, ok, type Result } from "../result";
import { decodeCursor, NEWEST_FIRST, olderThan, pageOf } from "../messages/cursor";
import {
  MESSAGE_BODY_MAX,
  MESSAGE_EMPTY,
  MESSAGE_TOO_LONG,
  PRESENCE_WINDOW_MS,
  toOfficeMessage,
  type OfficeMessageRow,
} from "../messages/office-chat";
import { badCursor, decodeKeyset, encodeKeyset } from "./cursor";

/** Replies email the cleaner when they're away (manager-access.ts rule 7). */
export const OFFICE_REPLY_LIMIT = { name: "manager-office-reply", max: 10, windowMs: 60_000 };

/** Who writes to the office as EMPLOYEE: the web's CORRESPONDENT_ROLES. */
const CORRESPONDENT_ROLES = ["EMPLOYEE", "FIELD_LEAD", "OPS_MANAGER"] as const;
const PAGE_SIZE = 50;
const MESSAGES_PAGE_SIZE = 30;
const NOT_FOUND = "This conversation isn't available.";
const FORBIDDEN = "Your role can't do this.";

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

/** From the office's side: the office's own sit on the right, whoever in it sent them. */
function officeSide(m: OfficeMessageRow, actor: Actor, slug: string): OfficeMessage {
  return { ...toOfficeMessage(m, actor, slug), fromMe: m.senderRole === "ADMIN" };
}

const guard = (actor: Actor) => (can(actor.role, "OFFICE_INBOX") ? null : failure(403, "FORBIDDEN", FORBIDDEN));

async function correspondent(cleanerId: string) {
  return db.user.findFirst({
    where: { id: cleanerId, role: { in: [...CORRESPONDENT_ROLES] } },
    select: { id: true, name: true, lastSeenAt: true },
  });
}

/** The correspondent's conversation, created if missing; race-safe on the unique employeeId. */
async function ensureConversation(employeeId: string): Promise<{ id: string }> {
  const find = () => db.chatConversation.findFirst({ where: { employeeId }, select: { id: true } });
  const existing = await find();
  if (existing) return existing;
  try {
    return await db.chatConversation.create({ data: { employeeId }, select: { id: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await find();
      if (row) return row;
    }
    throw e;
  }
}

const online = (lastSeenAt: Date | null, now: Date) =>
  !!lastSeenAt && lastSeenAt.getTime() >= now.getTime() - PRESENCE_WINDOW_MS;

async function unreadTotal(): Promise<number> {
  return db.chatMessage.count({
    where: {
      senderRole: "EMPLOYEE",
      readByAdminAt: null,
      conversation: { employee: { role: { in: [...CORRESPONDENT_ROLES] } } },
    },
  });
}

type Summary = OfficeConversation & { sortAt: number };

async function summaries(people: { id: string; name: string; lastSeenAt: Date | null }[], now: Date): Promise<Summary[]> {
  if (people.length === 0) return [];
  const conversations = await db.chatConversation.findMany({
    where: { employeeId: { in: people.map((p) => p.id) } },
    select: {
      id: true,
      employeeId: true,
      messages: { orderBy: NEWEST_FIRST, take: 1, select: { body: true, createdAt: true, senderRole: true } },
    },
  });
  const unread = await db.chatMessage.groupBy({
    by: ["conversationId"],
    where: { conversationId: { in: conversations.map((c) => c.id) }, senderRole: "EMPLOYEE", readByAdminAt: null },
    _count: { _all: true },
  });
  const unreadBy = new Map(unread.map((u) => [u.conversationId, u._count._all]));
  const byEmployee = new Map(conversations.map((c) => [c.employeeId, c]));
  return people.map((p) => {
    const c = byEmployee.get(p.id);
    const last = c?.messages[0];
    return {
      cleaner: { id: p.id, name: p.name },
      online: online(p.lastSeenAt, now),
      last: last
        ? { body: last.body.slice(0, 140), at: last.createdAt.toISOString(), fromOffice: last.senderRole === "ADMIN" }
        : null,
      unreadCount: c ? (unreadBy.get(c.id) ?? 0) : 0,
      sortAt: last ? last.createdAt.getTime() : 0,
    };
  });
}

const strip = (s: Summary): OfficeConversation => ({
  cleaner: s.cleaner,
  online: s.online,
  last: s.last,
  unreadCount: s.unreadCount,
});

/**
 * GET /manager/chat/conversations: unread first, then most recent, then by
 * name (getAdminChatList's order, with unread as a flag). The list is small
 * (a company's staff), so it is ordered in full and paged by the last
 * person's id: a cursor naming someone no longer listed answers 400, and the
 * app starts again from the top.
 */
export async function officeConversationsFor(
  actor: Actor,
  cursorRaw: string | undefined,
  now: Date,
): Promise<Result<OfficeConversationsResponse>> {
  const denied = guard(actor);
  if (denied) return denied;
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();

  const people = await db.user.findMany({
    where: { role: { in: [...CORRESPONDENT_ROLES] }, id: { not: actor.userId } },
    select: { id: true, name: true, lastSeenAt: true },
  });
  // Every correspondent has a row, so the list isn't empty before a first
  // message. Idempotent, as on the web.
  const existing = await db.chatConversation.findMany({
    where: { employeeId: { in: people.map((p) => p.id) } },
    select: { employeeId: true },
  });
  const have = new Set(existing.map((e) => e.employeeId));
  const missing = people.filter((p) => !have.has(p.id));
  if (missing.length) {
    await db.chatConversation.createMany({ data: missing.map((p) => ({ employeeId: p.id })), skipDuplicates: true });
  }

  const all = await summaries(people, now);
  all.sort(
    (a, b) =>
      Number(b.unreadCount > 0) - Number(a.unreadCount > 0) ||
      b.sortAt - a.sortAt ||
      a.cleaner.name.localeCompare(b.cleaner.name) ||
      a.cleaner.id.localeCompare(b.cleaner.id),
  );
  let start = 0;
  if (cursor) {
    const at = all.findIndex((s) => s.cleaner.id === cursor.id);
    if (at < 0) return badCursor();
    start = at + 1;
  }
  const page = all.slice(start, start + PAGE_SIZE);
  const more = start + PAGE_SIZE < all.length;
  const last = page[page.length - 1];
  return ok({
    items: page.map(strip),
    nextCursor: more && last ? encodeKeyset({ at: new Date(last.sortAt), id: last.cleaner.id }) : null,
    unreadTotal: await unreadTotal(),
  });
}

/** GET /manager/chat/conversations/:cleanerId */
export async function officeConversationFor(actor: Actor, cleanerId: string, now: Date): Promise<Result<OfficeConversation>> {
  const denied = guard(actor);
  if (denied) return denied;
  const person = await correspondent(cleanerId);
  if (!person || person.id === actor.userId) return notFound(NOT_FOUND);
  await ensureConversation(person.id);
  const [one] = await summaries([person], now);
  return ok(strip(one));
}

/** GET /manager/chat/conversations/:cleanerId/messages: newest first. Marks nothing read. */
export async function officeMessagesFor(
  actor: Actor,
  cleanerId: string,
  cursorRaw: string | undefined,
): Promise<Result<{ items: OfficeMessage[]; nextCursor: string | null }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const cursor = decodeCursor(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const person = await correspondent(cleanerId);
  if (!person || person.id === actor.userId) return notFound(NOT_FOUND);
  const conversation = await db.chatConversation.findFirst({ where: { employeeId: person.id }, select: { id: true } });
  if (!conversation) return ok({ items: [], nextCursor: null });
  const rows = await db.chatMessage.findMany({
    where: { conversationId: conversation.id, ...olderThan(cursor) },
    orderBy: NEWEST_FIRST,
    take: MESSAGES_PAGE_SIZE + 1,
    select: ROW_SELECT,
  });
  const page = pageOf(rows as OfficeMessageRow[], MESSAGES_PAGE_SIZE);
  const slug = await currentOrgSlug();
  return ok({ items: page.rows.map((m) => officeSide(m, actor, slug)), nextCursor: page.nextCursor });
}

/**
 * POST /manager/chat/conversations/:cleanerId/messages: reply as the office.
 * Delivered at once when the correspondent is online; otherwise the throttled
 * email to them, as an effect after the commit and never on a replay.
 */
export async function replyAsOffice(
  actor: Actor,
  cleanerId: string,
  input: { body: string; clientEventId: string; now: Date },
): Promise<Result<OfficeMessage>> {
  const denied = guard(actor);
  if (denied) return denied;
  const trimmed = input.body.trim();
  if (!trimmed) return failure(400, "VALIDATION_FAILED", MESSAGE_EMPTY);
  if (trimmed.length > MESSAGE_BODY_MAX) return failure(400, "VALIDATION_FAILED", MESSAGE_TOO_LONG);
  const person = await correspondent(cleanerId);
  if (!person || person.id === actor.userId) return notFound(NOT_FOUND);

  const slug = await currentOrgSlug();
  const conversation = await ensureConversation(person.id);
  const replayOf = async () => {
    const existing = await db.chatMessage.findFirst({
      where: { senderId: actor.userId, clientEventId: input.clientEventId, conversationId: conversation.id },
      select: ROW_SELECT,
    });
    return existing ? officeSide(existing as OfficeMessageRow, actor, slug) : null;
  };
  // A retry whose idempotency record has expired: the message is already there.
  const earlier = await replayOf();
  if (earlier) return ok(earlier);

  const now = input.now;
  const recipientOnline = online(person.lastSeenAt, now);
  let created: OfficeMessageRow;
  try {
    created = (await db.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: actor.userId,
          senderRole: "ADMIN",
          body: trimmed,
          clientEventId: input.clientEventId,
          readByAdminAt: now,
          deliveredAt: recipientOnline ? now : null,
          createdAt: now,
        },
        select: ROW_SELECT,
      });
      await tx.chatConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastAdminMessageAt: now },
      });
      return m;
    })) as OfficeMessageRow;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await replayOf();
      if (again) return ok(again);
    }
    throw e;
  }

  return ok(officeSide(created, actor, slug), [
    effect("office reply email", () =>
      notifyChatEmail({
        conversationId: conversation.id,
        senderRole: "ADMIN",
        senderName: actor.name ?? "The office",
        body: trimmed,
        recipientOnline,
      }),
    ),
    officeReplyPush(person.id, actor.userId, actor.name),
  ]);
}

/** POST /manager/chat/conversations/:cleanerId/read: the office has read the correspondent's messages. */
export async function markConversationReadFor(
  actor: Actor,
  cleanerId: string,
  now: Date,
): Promise<Result<{ unreadTotal: number }>> {
  const denied = guard(actor);
  if (denied) return denied;
  const person = await correspondent(cleanerId);
  if (!person || person.id === actor.userId) return notFound(NOT_FOUND);
  const conversation = await db.chatConversation.findFirst({ where: { employeeId: person.id }, select: { id: true } });
  if (conversation) {
    await db.chatMessage.updateMany({
      where: { conversationId: conversation.id, senderRole: "EMPLOYEE", readByAdminAt: null },
      data: { readByAdminAt: now },
    });
  }
  return ok({ unreadTotal: await unreadTotal() });
}
