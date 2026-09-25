import { NextResponse } from "next/server";
import {
  getJobChatUnread,
  type JobChatUnreadScope,
} from "@/lib/jobChatUnread";

const SCOPES: JobChatUnreadScope[] = ["admin", "cleaner", "client"];

function isScope(v: string | null): v is JobChatUnreadScope {
  return !!v && (SCOPES as string[]).includes(v);
}

/**
 * Unread job-chat (cleaner ↔ client) counts for one side of the conversation.
 *
 * A `GET` handler rather than the server action it used to be: this poll is
 * mounted in the admin sidebar, the cleaner sidebar AND the customer portal
 * shell, i.e. on essentially every authenticated page, and a server action
 * response re-renders the route the caller is standing on. See
 * src/lib/chatUnread.ts for the measurements that forced the move.
 *
 * `scope` is browser-supplied and grants nothing — `getJobChatUnread`
 * authorises each scope independently and returns an empty result otherwise,
 * exactly as it did when it was an action.
 */
export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  if (!isScope(scope)) {
    return NextResponse.json({ error: "Unknown scope" }, { status: 400 });
  }
  const data = await getJobChatUnread(scope);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
