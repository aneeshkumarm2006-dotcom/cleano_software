// Ending sessions when someone's access changes.
//
// Switching someone off, or deleting them, used to flip a flag and nothing
// more. Sessions last thirty days and slide forward with use, and only the
// cleaner layout ever read `isActive`, so a switched-off cleaner who kept the
// app open, or who called a server action directly, went on working: claiming
// jobs, chatting, requesting withdrawals.
//
// Three layers now make "switched off" true everywhere:
//   1. customSession (auth.ts) treats a switched-off person as signed out;
//   2. the session-create hook (auth.ts) refuses them a new session;
//   3. this module deletes the sessions they already hold.
import "server-only";

import { db } from "@/lib/org-db";

/**
 * End every session held by people who are switched off or deleted.
 *
 * `Session` is not a tenant model — better-auth owns it and it carries no
 * organizationId — so a raw `deleteMany` by user id would reach across
 * companies. The ids are narrowed through the organization-scoped `user` table
 * first, and only to people whose row says they are switched off or deleted.
 * An id from another company, a customer caught in a bulk selection, or
 * someone the caller only thought it deactivated, keeps their sessions.
 *
 * Returns how many sessions were ended.
 */
export async function endSessionsOfSwitchedOffUsers(
  userIds: readonly string[],
): Promise<number> {
  if (userIds.length === 0) return 0;

  const switchedOff = await db.user.findMany({
    where: {
      id: { in: [...userIds] },
      OR: [{ isActive: false }, { deletedAt: { not: null } }],
    },
    select: { id: true },
  });
  if (switchedOff.length === 0) return 0;

  const res = await db.session.deleteMany({
    where: { userId: { in: switchedOff.map((u) => u.id) } },
  });
  return res.count;
}

/**
 * End every session this person holds except the one making the request.
 *
 * For a password change: whoever knew the old password — a temporary one an
 * admin set, or one someone else saw — is signed out, and the person who just
 * chose the new one is not.
 */
export async function endOtherSessions(userId: string, keepToken: string): Promise<number> {
  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!person) return 0;

  const res = await db.session.deleteMany({
    where: { userId: person.id, NOT: { token: keepToken } },
  });
  return res.count;
}

/**
 * End every session this person holds.
 *
 * For a password someone else set — an admin handing over a new one, or
 * Bookmops staff rescuing an owner. Whoever was signed in with the old
 * password, on any device, has to sign in again with the new one.
 */
export async function endAllSessionsOf(userId: string): Promise<number> {
  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!person) return 0;

  const res = await db.session.deleteMany({ where: { userId: person.id } });
  return res.count;
}
