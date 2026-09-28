import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";

const PRESENCE_TTL_MS = 60_000;

/**
 * Heartbeat endpoint. Clients ping this every ~20s while the tab is visible.
 * Updates the caller's `lastSeenAt`. Used to render WhatsApp-style ticks
 * (online = pinged within PRESENCE_TTL_MS).
 */
export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const now = new Date();
    await db.user.update({
      where: { id: session.user.id },
      data: { lastSeenAt: now },
    });

    // On every ping, mark any messages addressed to this user as "delivered"
    // if they haven't been already. Keeps the ✓✓ state up to date even when
    // the user isn't on the chat page.
    if ((session.user as { role?: string }).role === "EMPLOYEE") {
      const convo = await db.chatConversation.findUnique({
        where: { employeeId: session.user.id },
        select: { id: true },
      });
      if (convo) {
        await db.chatMessage.updateMany({
          where: {
            conversationId: convo.id,
            senderRole: "ADMIN",
            deliveredAt: null,
          },
          data: { deliveredAt: now },
        });
      }
    } else {
      await db.chatMessage.updateMany({
        where: {
          senderRole: "EMPLOYEE",
          deliveredAt: null,
        },
        data: { deliveredAt: now },
      });
    }

    return NextResponse.json({ ok: true, at: now.toISOString() });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export const PRESENCE_ONLINE_WINDOW_MS = PRESENCE_TTL_MS;
