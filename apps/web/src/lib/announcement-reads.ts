// How many announcements a person has not opened.
//
// Its own module rather than a method on the announcements action file: the
// cleaner layout renders on every page and must not pull in the publishing,
// editing and reaction machinery to draw one number.
import "server-only";

import { db } from "@/lib/org-db";

/** Unread announcements for this user. Never throws — a badge is not worth a 500. */
export async function countUnreadAnnouncements(userId: string): Promise<number> {
  try {
    const [total, read] = await Promise.all([
      db.announcement.count(),
      db.announcementRead.count({ where: { userId } }),
    ]);
    // Reads cascade with their announcement, so this cannot go negative in
    // normal operation; clamped anyway rather than rendering "-1 new".
    return Math.max(0, total - read);
  } catch {
    return 0;
  }
}
