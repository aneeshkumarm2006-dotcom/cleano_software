// NOT "use server" any more.
//
// This was a server action polled every 5 s by the admin sidebar, the cleaner
// sidebar and the customer portal shell. A server action's response carries an
// RSC re-render of whatever route the caller is standing on, and actions are
// serialised per tab, so the badge was restarting the render of every page it
// decorated — on /admin/analytics (15-20 s of server work per render) that made
// user-initiated navigations unable to commit at all. The only caller now is
// the GET handler at src/app/api/job-chat/unread/route.ts; the full write-up
// lives in src/lib/chatUnread.ts.
//
// Client components may still `import type` the two types below — type imports
// are erased, so none of this file reaches the browser bundle.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import type { Prisma } from "@prisma/client";

/**
 * Which side of a job chat the caller is asking about. Each surface asks for
 * its own scope, and each scope is independently authorized below — the browser
 * naming a scope grants it nothing.
 */
export type JobChatUnreadScope = "admin" | "cleaner" | "client";

export interface JobChatUnread {
  /** Unread messages across every job in scope. */
  total: number;
  /** Per-job counts, so a list can mark the rows that need an answer. */
  byJob: Record<string, number>;
}

const EMPTY: JobChatUnread = { total: 0, byJob: {} };

// Must match ADMIN_ROLES in src/lib/role-routing.ts (same list jobChatActions
// uses to decide who may read a thread as ADMIN).
function isAdminRole(role: string | undefined) {
  return (
    role === "OWNER" ||
    role === "ADMIN" ||
    role === "OPS_MANAGER" ||
    role === "FIELD_LEAD"
  );
}

/**
 * Count job-chat messages the caller hasn't read, for one side of the
 * conversation.
 *
 * The read columns are per *role*, not per user — `getJobChatMessages` stamps
 * `readBy<Role>At` when the thread is opened — so the counts here clear exactly
 * when the thread is read, on the side that read it. Someone who is both an
 * admin and an assigned cleaner therefore has two independent counts, one per
 * surface, and neither can get stuck behind the other.
 *
 * One `groupBy` per call, filtered through the job relation, so a list of any
 * length costs a single query (the caller shares one SWR key across its rows).
 */
export async function getJobChatUnread(
  scope: JobChatUnreadScope
): Promise<JobChatUnread> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return EMPTY;
    const user = session.user as { id: string; email?: string; role?: string };

    // Archived jobs are out of scope on every side: the cleaner's list, the
    // customer's history and the invite flow all treat them as gone, so they
    // must not sit in a badge nobody can clear.
    let where: Prisma.JobChatMessageWhereInput;

    // A message an admin has hidden (CLN-P0-3-17) badges nobody. The cleaner
    // and the client can't open it to clear the count, and an admin hiding a
    // message has by definition already read it.
    if (scope === "admin") {
      if (!isAdminRole(user.role)) return EMPTY;
      where = {
        senderRole: { not: "ADMIN" },
        readByAdminAt: null,
        hiddenAt: null,
        job: { deletedAt: null },
      };
    } else if (scope === "cleaner") {
      // Self-limiting: only jobs this user leads or is assigned to.
      where = {
        senderRole: { not: "CLEANER" },
        readByCleanerAt: null,
        hiddenAt: null,
        job: {
          deletedAt: null,
          OR: [{ employeeId: user.id }, { cleaners: { some: { id: user.id } } }],
        },
      };
    } else {
      const email = user.email?.toLowerCase();
      if (!email) return EMPTY;
      const client = await db.client.findFirst({
        where: { email },
        select: { id: true },
      });
      if (!client) return EMPTY;
      where = {
        senderRole: { not: "CLIENT" },
        readByClientAt: null,
        hiddenAt: null,
        job: { deletedAt: null, clientId: client.id },
      };
    }

    const rows = await db.jobChatMessage.groupBy({
      by: ["jobId"],
      where,
      _count: { _all: true },
    });

    const byJob: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byJob[r.jobId] = r._count._all;
      total += r._count._all;
    }
    return { total, byJob };
  } catch {
    // A badge must never take down the page it decorates.
    return EMPTY;
  }
}
