import { NextResponse } from "next/server";
import { readUnreadChatCount } from "@/lib/chatUnread";

/**
 * Staff-chat unread badge + "new message" toast feed for the admin and cleaner
 * sidebars.
 *
 * NOT under /api/admin: the cleaner sidebar polls the same endpoint, and
 * `readUnreadChatCount` already branches on the caller's role to decide which
 * side of the conversation they are reading. A path that says "admin" while
 * EMPLOYEE sessions legitimately call it would invite exactly the blanket rule
 * that would then break the cleaner badge.
 *
 * The session check lives in `readUnreadChatCount` — an unauthenticated caller
 * gets `{ count: 0 }` and no message bodies, which is the same contract the
 * server action this replaces had. See that file for why it is no longer an
 * action.
 */
export async function GET() {
  const data = await readUnreadChatCount();
  // A badge read must never be served from a cache, and this response contains
  // one user's message preview — it must not land in a shared cache either.
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
