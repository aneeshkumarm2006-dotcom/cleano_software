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
//   3. this module deletes the sessions they already hold, and the push
//      tokens registered under them (PushDevice): a phone that can't sign in
//      shouldn't go on receiving the company's notifications.
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

  const ids = switchedOff.map((u) => u.id);
  // Tokens first: a row whose session goes also goes by cascade, but rows
  // registered before sessions were recorded on them (sessionId null) don't.
  await db.pushDevice.deleteMany({ where: { userId: { in: ids } } });
  const res = await db.session.deleteMany({
    where: { userId: { in: ids } },
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

  // Every push token but the ones this session registered.
  const keep = await db.session.findUnique({ where: { token: keepToken }, select: { id: true, userId: true } });
  const keepId = keep && keep.userId === person.id ? keep.id : null;
  await db.pushDevice.deleteMany({
    where: {
      userId: person.id,
      ...(keepId ? { OR: [{ sessionId: null }, { sessionId: { not: keepId } }] } : {}),
    },
  });
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

  await db.pushDevice.deleteMany({ where: { userId: person.id } });
  const res = await db.session.deleteMany({ where: { userId: person.id } });
  return res.count;
}

/**
 * Delete every push token this person registered, on every session. For a
 * completed password reset: better-auth ends their sessions itself (and the
 * tokens under them by cascade); this catches rows from before tokens were
 * tied to a session.
 */
export async function endPushDevicesOf(userId: string): Promise<number> {
  const res = await db.pushDevice.deleteMany({ where: { userId } });
  return res.count;
}
