"use client";

import useSWR from "swr";
import {
  getJobChatUnread,
  type JobChatUnread,
  type JobChatUnreadScope,
} from "@/lib/jobChatUnread";

/**
 * Unread job-chat counts for one side of the conversation.
 *
 * Every consumer of a given scope shares one SWR key, so a 100-row job list and
 * the nav badge above it together cost exactly one request per poll — the same
 * shape and 5s cadence as the existing staff-chat badge, not a heavier poll.
 */
export function useJobChatUnread(scope: JobChatUnreadScope) {
  const { data } = useSWR<JobChatUnread>(
    ["job-chat-unread", scope],
    () => getJobChatUnread(scope),
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );
  return data ?? { total: 0, byJob: {} };
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
