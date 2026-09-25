// The in-app notification feed for admins.
//
// Until this existed, every admin notification was an email and nothing else.
// "We never heard the cleaner clocked out" could only be answered by digging
// through an inbox, and the answer was often a preference toggle somebody
// turned off months ago. So the EVENT is now recorded in the app regardless of
// whether the email was enabled or delivered — the toggles decide what gets
// SENT, not what happened.
import "server-only";

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";

export type NotificationSeverity = "INFO" | "WARN" | "ERROR";

export interface AdminNotificationInput {
  /** The catalog key, e.g. "admin.clock.clocked_out". */
  key: string;
  title: string;
  body?: string | null;
  /** Relative path to act on it, e.g. `/admin/jobs/123`. */
  href?: string | null;
  severity?: NotificationSeverity;
}

/**
 * Record one event for the whole workspace.
 *
 * Called ONCE per event, not once per admin: the row is shared and each person
 * marks their own copy read. Never throws — a feed entry must never be the
 * reason a clock-out fails.
 */
export async function recordAdminNotification(
  input: AdminNotificationInput,
): Promise<void> {
  try {
    await db.notification.create({
      data: {
        notificationKey: input.key,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 1000) ?? null,
        href: input.href ?? null,
        severity: input.severity ?? "INFO",
      },
    });
  } catch (e) {
    // Sept 10, item 4: "notification failures should be logged so admin/devs
    // can see if the issue is email, push, backend trigger, or UI display."
    // A console line answers that for nobody: it is on a server nobody reads,
    // and by the time the question is asked it has rotated away. The row below
    // is the answer, in /admin/logs, naming which event was lost and why.
    //
    // Still never throws. A feed entry must not be the reason a clock-out
    // fails, which is the whole point of this function.
    console.error("[notifications] could not record", input.key, e);
    await logActivity({
      category: "ADMIN",
      action: "notification.record_failed",
      status: "FAILED",
      message: `The in-app notification "${input.title}" (${input.key}) could not be recorded, so it is missing from the feed and from the sidebar count.`,
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {});
  }
}

/**
 * How many notifications this admin has not opened. Drives the sidebar badge.
 *
 * Asked as a question about THIS person's read rows rather than as arithmetic
 * (Sept 10, item 4, "notification badges/counts should update properly"). The
 * subtraction it replaces — every notification, minus every read row this user
 * has — is only correct while the two sets line up perfectly, and one thing
 * guarantees they do not: the feed page lists the newest 50. Read 50 of 200 and
 * the badge sat at 150 with nothing on screen left to clear, forever, climbing
 * as new events arrived. `markAllAdminNotificationsRead` below is the other
 * half of that fix.
 */
export async function countUnreadAdminNotifications(userId: string): Promise<number> {
  try {
    return await db.notification.count({
      // "No read row for this person at all."
      //
      // Archiving WRITES a read row (with `dismissedAt` set), so a dismissed
      // notification is excluded by this same condition and needs no clause of
      // its own. Adding `dismissedAt: null` inside `none` would invert that: a
      // dismissed row would stop matching, `none` would be satisfied, and the
      // notification the admin had just archived would come back as unread.
      where: { reads: { none: { userId } } },
    });
  } catch {
    // A badge is never worth a 500 on every admin page.
    return 0;
  }
}

export interface AdminNotificationDTO {
  id: string;
  key: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: string;
  createdAt: string;
  read: boolean;
  /** Archived by this admin. Kept in history, out of the default feed. */
  dismissed: boolean;
}

/**
 * The newest notifications, with this person's read state folded in.
 *
 * Archived rows are left out unless asked for (Sept 10, item 13). The PDF's
 * rule is that history survives — so an archived notification is hidden, never
 * deleted, and `includeDismissed` is how the Archived view gets it back.
 */
export async function listAdminNotifications(
  userId: string,
  limit = 50,
  includeDismissed = false,
): Promise<AdminNotificationDTO[]> {
  try {
    const rows = await db.notification.findMany({
      where: includeDismissed
        ? undefined
        : { reads: { none: { userId, dismissedAt: { not: null } } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(200, limit),
      include: {
        reads: { where: { userId }, select: { id: true, dismissedAt: true } },
      },
    });
    return rows.map((n) => ({
      id: n.id,
      key: n.notificationKey,
      title: n.title,
      body: n.body,
      href: n.href,
      severity: n.severity,
      createdAt: n.createdAt.toISOString(),
      read: n.reads.length > 0,
      dismissed: n.reads.some((r) => r.dismissedAt != null),
    }));
  } catch {
    return [];
  }
}

/**
 * Mark these as seen by this person. Idempotent by the unique pair, so
 * re-opening the panel does not move the timestamp.
 */
export async function markAdminNotificationsRead(
  userId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const res = await db.notificationRead.createMany({
      data: ids.slice(0, 200).map((notificationId) => ({ notificationId, userId })),
      skipDuplicates: true,
    });
    return res.count;
  } catch {
    return 0;
  }
}

/**
 * Mark everything this person has not read, including what the feed page never
 * showed them.
 *
 * The page lists the newest 50, so marking "what is on screen" could never
 * empty a badge counting 200. This works from the unread set itself, in
 * batches, so the count can actually reach zero.
 *
 * Returns how many rows it wrote. Never throws, for the same reason as the
 * rest of this file.
 */
export async function markAllAdminNotificationsRead(
  userId: string,
): Promise<number> {
  try {
    let marked = 0;
    // Bounded rather than unbounded: a workspace that has never cleared its
    // feed should not turn one click into a single enormous write. Ten batches
    // of 500 clears five thousand, and the next click clears the next five.
    for (let batch = 0; batch < 10; batch++) {
      const unread = await db.notification.findMany({
        // Same reasoning as the count above: an archived notification already
        // has a read row, so it is excluded here and must not be re-listed.
        where: { reads: { none: { userId } } },
        select: { id: true },
        take: 500,
      });
      if (unread.length === 0) break;
      const res = await db.notificationRead.createMany({
        data: unread.map((n) => ({ notificationId: n.id, userId })),
        skipDuplicates: true,
      });
      marked += res.count;
      // A batch that wrote nothing means every row was already read by someone
      // else's race; stop rather than loop on the same page.
      if (res.count === 0) break;
    }
    return marked;
  } catch {
    return 0;
  }
}

/**
 * Archive one notification for one admin (Sept 10, item 13).
 *
 * Archiving implies reading, so the row carries both stamps. Upserted, because
 * an admin can archive something they had already read and the unique pair
 * means there is at most one row to move.
 *
 * Per-person by construction: `NotificationRead` is keyed on
 * (notificationId, userId), so one admin clearing their own feed leaves
 * everyone else's alone. Nothing is deleted, so the Archived view can still
 * show it.
 */
export async function dismissAdminNotification(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  try {
    await db.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      update: { dismissedAt: new Date() },
      create: { notificationId, userId, dismissedAt: new Date() },
    });
    return true;
  } catch (e) {
    console.error("[notifications] could not archive", notificationId, e);
    return false;
  }
}

/** Put an archived notification back in the feed. */
export async function restoreAdminNotification(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  try {
    await db.notificationRead.updateMany({
      where: { notificationId, userId },
      data: { dismissedAt: null },
    });
    return true;
  } catch (e) {
    console.error("[notifications] could not restore", notificationId, e);
    return false;
  }
}
