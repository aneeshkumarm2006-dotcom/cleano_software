import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import type { Prisma } from "@prisma/client";
import { isAdminRole } from "@/lib/role-routing";

/**
 * Staff-chat unread count + the newest unread message, for whichever side of
 * the conversation the caller is on.
 *
 * WHY THIS IS A PLAIN MODULE AND NOT A SERVER ACTION.
 *
 * This used to be `getUnreadChatCount` in src/app/admin/chat/actions.ts, called
 * every 5 s from the admin and cleaner sidebars. A Next.js server action's
 * response carries an RSC re-render of whatever route the caller is standing
 * on, and actions are serialised per tab. On an expensive page — /admin/analytics
 * runs ~18 queries against a remote pooler and costs 15-20 s of server work —
 * that meant a concurrent render was being restarted every few seconds, forever,
 * and a `router.replace` the admin actually asked for could never win the race:
 * QA measured 5 POSTs to /admin/analytics in a 30 s IDLE window, and 3 of 4
 * filter clicks never committed at all even though the RSC payload for the new
 * URL came back 200.
 *
 * A `GET` route handler returns JSON and re-renders nothing. That is the whole
 * point of the move — see src/app/api/chat/unread/route.ts, which is the only
 * caller, and the same reasoning already written up in
 * src/app/api/admin/jobs/[id]/logs/route.ts.
 *
 * Never throws: a badge must not take down the page it decorates.
 */
export interface UnreadChatCount {
  count: number;
  latest?: { senderName: string; body: string; at: string };
}

export async function readUnreadChatCount(): Promise<UnreadChatCount> {
  try {
    // Same gate the server action performed. An unauthenticated caller gets
    // zeroes and no message bodies — the endpoint is not open.
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { count: 0 };
    const user = session.user as { id: string; role?: string };

    if (isAdminRole(user.role)) {
      const where: Prisma.ChatMessageWhereInput = {
        senderRole: "EMPLOYEE",
        readByAdminAt: null,
      };
      const count = await db.chatMessage.count({ where });
      const latest =
        count > 0
          ? await db.chatMessage.findFirst({
              where,
              orderBy: { createdAt: "desc" },
              include: { sender: { select: { name: true } } },
            })
          : null;
      return {
        count,
        latest: latest
          ? {
              senderName: latest.sender.name,
              body: latest.body,
              at: latest.createdAt.toISOString(),
            }
          : undefined,
      };
    }

    const conversation = await db.chatConversation.findUnique({
      where: { employeeId: user.id },
    });
    if (!conversation) return { count: 0 };

    const where: Prisma.ChatMessageWhereInput = {
      conversationId: conversation.id,
      senderRole: "ADMIN",
      readByEmployeeAt: null,
    };
    const count = await db.chatMessage.count({ where });
    const latest =
      count > 0
        ? await db.chatMessage.findFirst({
            where,
            orderBy: { createdAt: "desc" },
            include: { sender: { select: { name: true } } },
          })
        : null;
    return {
      count,
      latest: latest
        ? {
            senderName: latest.sender.name,
            body: latest.body,
            at: latest.createdAt.toISOString(),
          }
        : undefined,
    };
  } catch {
    return { count: 0 };
  }
}
