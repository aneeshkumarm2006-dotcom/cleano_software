// Sample issue reports for development builds, held in memory so a report
// sent from the form shows up in the list below it.
import type { JobIssue } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";

const issues = new Map<string, JobIssue[]>();
function issuesOf(jobId: string): JobIssue[] {
  let list = issues.get(jobId);
  if (!list) {
    list =
      jobId === "p1"
        ? [
            {
              id: "i-p1",
              category: "SUPPLIES",
              urgency: "NORMAL",
              status: "RESOLVED",
              note: "Mop head is falling apart.",
              reportedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
              hasPhoto: false,
              resolutionNote: "A new one is in your kit for Thursday.",
            },
          ]
        : [];
    issues.set(jobId, list);
  }
  return list;
}

/** Reporting is idempotent on clientEventId, as the server's is. */
const byEvent = new Map<string, JobIssue>();

export const previewIssuesApi = {
  jobIssues: (jobId) => delay({ items: issuesOf(jobId), nextCursor: null }),
  reportJobIssue: (jobId, body) => {
    const again = byEvent.get(body.clientEventId);
    if (again) return delay(again, 200);
    const issue: JobIssue = {
      id: `i-${body.clientEventId.slice(0, 8)}`,
      category: body.category,
      urgency: body.urgency,
      status: "OPEN",
      note: body.note.trim(),
      reportedAt: new Date().toISOString(),
      hasPhoto: !!body.photoKey,
      resolutionNote: null,
    };
    issues.set(jobId, [issue, ...issuesOf(jobId)]);
    byEvent.set(body.clientEventId, issue);
    return delay(issue, 500);
  },
} satisfies Pick<DataSource, "jobIssues" | "reportJobIssue">;
