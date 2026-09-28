"use client";

import useSWR from "swr";
import type {
  JobChatUnread,
  JobChatUnreadScope,
} from "@/lib/jobChatUnread";

const EMPTY: JobChatUnread = { total: 0, byJob: {} };

/**
 * Plain GET, deliberately — this used to call the `getJobChatUnread` SERVER
 * ACTION every 5 s.
 *
 * A server action's response carries an RSC re-render of whatever route the
 * caller is standing on, and actions are serialised per tab. This hook is
 * mounted in the admin sidebar, the cleaner sidebar and the customer portal
 * shell, i.e. on essentially every authenticated page, so the badge was
 * restarting the render of the page it decorated every few seconds. On
 * /admin/analytics — 15-20 s of server work per render — that starved
 * user-initiated navigations outright: QA measured filter clicks whose RSC
 * payload came back 200 and yet never committed after 200+ seconds.
 *
 * A route handler returns JSON and re-renders nothing.
 */
async function fetchJobChatUnread(
  scope: JobChatUnreadScope
): Promise<JobChatUnread> {
  const res = await fetch(
    `/api/job-chat/unread?scope=${encodeURIComponent(scope)}`,
    { credentials: "include", cache: "no-store" }
  );
  if (!res.ok) throw new Error(`job-chat unread ${res.status}`);
  return (await res.json()) as JobChatUnread;
}

/**
 * Unread job-chat counts for one side of the conversation.
 *
 * Every consumer of a given scope shares one SWR key, so a 100-row job list and
 * the nav badge above it together cost exactly one request per poll.
 *
 * 30s, not the 5s it used to run at. The count itself is one `groupBy` against
 * a remote pooler with 1.7-3.5 s round trips, so a 5 s beat spent a large
 * fraction of every minute in flight for a badge nobody is watching that
 * closely; an open conversation still updates on its own 3-4 s thread poll, so
 * nothing a user is actually reading got slower. `refreshWhenHidden: false` is
 * SWR's default and is stated explicitly here because it is load-bearing: a
 * backgrounded tab must stop paying for this.
 */
export function useJobChatUnread(scope: JobChatUnreadScope) {
  const { data } = useSWR<JobChatUnread>(
    ["job-chat-unread", scope],
    () => fetchJobChatUnread(scope),
    {
      refreshInterval: 30_000,
      refreshWhenHidden: false,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );
  return data ?? EMPTY;
}

/**
 * A small "N new" pill for a single job, for job/booking lists. Renders nothing
 * when that job has no unread messages.
 */
export default function JobChatUnreadPill({
  jobId,
  scope,
}: {
  jobId: string;
  scope: JobChatUnreadScope;
}) {
  const { byJob } = useJobChatUnread(scope);
  const count = byJob[jobId] ?? 0;
  if (count < 1) return null;
  return (
    <span
      className="job-chat-unread-pill"
      title={`${count} unread message${count === 1 ? "" : "s"} in this job's chat`}>
      {count > 99 ? "99+" : count} new
    </span>
  );
}
