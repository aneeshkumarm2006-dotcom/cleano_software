import type { JobIssue, JobIssuesResponse, ReportIssueRequest } from "@bookmops/api/v1";
import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const issueKeys = {
  issues: (jobId: string) => ["issues", jobId] as const,
};

/** This cleaner's own reports on a job, newest first. */
export function useJobIssues(jobId: string) {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: issueKeys.issues(jobId),
    queryFn: ({ pageParam }) => source.jobIssues(jobId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/**
 * Send a report. The caller makes `clientEventId` once per report and keeps
 * it for retries, so a retry after a dropped connection files it once.
 */
export function useReportIssue(jobId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReportIssueRequest) => source.reportJobIssue(jobId, body),
    onSuccess: (issue: JobIssue) => {
      qc.setQueryData<InfiniteData<JobIssuesResponse, string | null>>(issueKeys.issues(jobId), (prev) => {
        if (!prev?.pages[0] || prev.pages.some((p) => p.items.some((i) => i.id === issue.id))) return prev;
        const [first, ...rest] = prev.pages;
        return { ...prev, pages: [{ ...first, items: [issue, ...first.items] }, ...rest] };
      });
      void qc.invalidateQueries({ queryKey: issueKeys.issues(jobId) });
    },
  });
}
