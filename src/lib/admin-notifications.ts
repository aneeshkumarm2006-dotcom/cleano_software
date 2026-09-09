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
    console.error("[notifications] could not record", input.key, e);
  }
}

/** How many notifications this admin has not opened. Drives the sidebar badge. */
export async function countUnreadAdminNotifications(userId: string): Promise<number> {
  try {
    const [total, read] = await Promise.all([
      db.notification.count(),
      db.notificationRead.count({ where: { userId } }),
    ]);
    return Math.max(0, total - read);
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
}

/** The newest notifications, with this person's read state folded in. */
export async function listAdminNotifications(
  userId: string,
  limit = 50,
): Promise<AdminNotificationDTO[]> {
  try {
    const rows = await db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(200, limit),
      include: { reads: { where: { userId }, select: { id: true } } },
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
