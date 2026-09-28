// Blocking in team chat (App Store guideline 1.2; /api/v1/team/blocks).
//
// While A blocks B:
//   - B's team messages are left out of A's message lists and unread counts
//     (team-chat.ts), server-side, so their text never reaches A's phone;
//   - a direct message between them can't be opened or sent, either way
//     round (403 BLOCKED);
//   - B isn't told, and office chat is unaffected: it is each person's line to
//     their employer.
// Anyone on the staff can block anyone else on the staff of the same company,
// office roles included (in team chat only). Nobody can block themselves.
import "server-only";

import { Prisma } from "@prisma/client";
import type { BlockedPerson, BlockResponse } from "@bookmops/api/v1";

import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Result } from "../result";

const STAFF_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"] as const;

export const BLOCKED = "You can't message this person.";

/** The people this person has blocked, by id. */
export async function blockedIdsFor(userId: string): Promise<string[]> {
  const rows = await db.teamChatBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true } });
  return rows.map((r) => r.blockedId);
}

/** Whether either of the two has blocked the other. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const row = await db.teamChatBlock.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return !!row;
}

const PERSON_NOT_FOUND = "This person isn't available.";

function isStaff(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

export async function listBlocks(actor: Actor): Promise<Result<{ items: BlockedPerson[]; nextCursor: null }>> {
  if (!isStaff(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  const rows = await db.teamChatBlock.findMany({
    where: { blockerId: actor.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { blockedId: true, createdAt: true, blocked: { select: { name: true } } },
  });
  return ok({
    items: rows.map((r) => ({ id: r.blockedId, name: r.blocked.name, blockedAt: r.createdAt.toISOString() })),
    nextCursor: null,
  });
}

/** Block a person. Blocking someone already blocked answers the same. */
export async function blockPerson(actor: Actor, userId: string): Promise<Result<BlockResponse>> {
  if (!isStaff(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  if (typeof userId !== "string" || !userId) return notFound(PERSON_NOT_FOUND);
  if (userId === actor.userId) return failure(400, "CANNOT_BLOCK_SELF", "You can't block yourself.");
  // Scoped: someone in another company is simply not found. Inactive people
  // can still be blocked: their old messages are still in the channels.
  const other = await db.user.findFirst({
    where: { id: userId, role: { in: [...STAFF_ROLES] }, deletedAt: null },
    select: { id: true },
  });
  if (!other) return notFound(PERSON_NOT_FOUND);
  try {
    await db.teamChatBlock.create({ data: { blockerId: actor.userId, blockedId: other.id }, select: { id: true } });
  } catch (e) {
    // Already blocked (a double tap, a retry): the same answer.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
  }
  return ok({ userId: other.id, blocked: true });
}

/** Unblock a person. Unblocking someone who isn't blocked answers the same. */
export async function unblockPerson(actor: Actor, userId: string): Promise<Result<BlockResponse>> {
  if (!isStaff(actor.role)) return failure(403, "FORBIDDEN", "Not authorized");
  if (typeof userId !== "string" || !userId) return notFound(PERSON_NOT_FOUND);
  if (userId === actor.userId) return failure(400, "CANNOT_BLOCK_SELF", "You can't block yourself.");
  await db.teamChatBlock.deleteMany({ where: { blockerId: actor.userId, blockedId: userId } });
  return ok({ userId, blocked: false });
}
