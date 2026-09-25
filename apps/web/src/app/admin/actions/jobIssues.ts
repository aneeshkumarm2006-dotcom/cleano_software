"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  isOpenIssueStatus,
  jobIssueCategoryLabel,
  JOB_ISSUE_STATUSES,
  JOB_ISSUE_STATUS_LABEL,
  MAX_ISSUE_DESCRIPTION,
  parseJobIssueStatus,
  parseJobIssueUrgency,
} from "@/lib/job-issues";

/**
 * What the admin screens see. A shaped object rather than the Prisma row: the
 * row carries `organizationId` and whatever columns the model gains next, and
 * a server action's return value is serialised straight into a client bundle.
 */
export interface JobIssueDTO {
  id: string;
  jobId: string;
  jobNumber: number;
  clientName: string;
  reportedById: string | null;
  reportedByName: string;
  category: string;
  categoryLabel: string;
  urgency: string;
  status: string;
  statusLabel: string;
  description: string;
  photoUrl: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export async function listJobIssues(filter?: {
  status?: string;
  jobId?: string;
  limit?: number;
}): Promise<{ ok: true; issues: JobIssueDTO[] } | { ok: false; message: string }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  // An unrecognised status filter would otherwise match nothing and read as
  // "there are no issues", which is the one wrong answer this screen can give.
  const status =
    typeof filter?.status === "string" && filter.status.trim().length > 0
      ? parseJobIssueStatus(filter.status)
      : undefined;

  const rows = await db.jobIssue.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(filter?.jobId ? { jobId: filter.jobId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, filter?.limit ?? 100)),
    include: { job: { select: { jobNumber: true, clientName: true } } },
  });

  return {
    ok: true,
    issues: rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      jobNumber: r.job.jobNumber,
      clientName: r.job.clientName,
      reportedById: r.reportedById,
      reportedByName: r.reportedByName,
      category: r.category,
      categoryLabel: jobIssueCategoryLabel(r.category),
      urgency: parseJobIssueUrgency(r.urgency),
      status: parseJobIssueStatus(r.status),
      statusLabel: JOB_ISSUE_STATUS_LABEL[parseJobIssueStatus(r.status)],
      description: r.description,
      photoUrl: r.photoUrl,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedById: r.resolvedById,
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Move an issue along its life cycle.
 *
 * ACKNOWLEDGED means somebody in the office has it; RESOLVED means it is done
 * and records who said so. Reopening clears the resolution rather than leaving
 * one attached to an open issue, which would read as "fixed" on every screen
 * that shows the note.
 */
export async function setJobIssueStatus(
  issueId: string,
  status: string,
  resolutionNote?: string,
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  const next = parseJobIssueStatus(status);
  const note =
    typeof resolutionNote === "string" && resolutionNote.trim().length > 0
      ? resolutionNote.trim().slice(0, MAX_ISSUE_DESCRIPTION)
      : null;

  const issue = await db.jobIssue.findUnique({
    where: { id: issueId },
    select: { id: true, jobId: true, category: true, acknowledgedAt: true },
  });
  if (!issue) return { ok: false, message: "That issue no longer exists." };

  const now = new Date();

  await db.jobIssue.update({
    where: { id: issueId },
    data: {
      status: next,
      // Resolving implies somebody read it, so a straight OPEN → RESOLVED still
      // leaves an acknowledged-at behind; without it the timeline shows a jump
      // with no first-response time in it.
      acknowledgedAt:
        next === "OPEN" ? null : (issue.acknowledgedAt ?? now),
      resolvedAt: next === "RESOLVED" ? now : null,
      resolvedById: next === "RESOLVED" ? guard.userId : null,
      resolutionNote: next === "RESOLVED" ? note : null,
    },
  });

  await db.jobLog
    .create({
      data: {
        jobId: issue.jobId,
        userId: guard.userId,
        action: "NOTE_ADDED",
        field: "issue",
        newValue: next,
        description:
          next === "RESOLVED"
            ? `Issue resolved (${jobIssueCategoryLabel(issue.category)})${note ? `: ${note}` : "."}`
            : `Issue marked ${JOB_ISSUE_STATUS_LABEL[next].toLowerCase()} (${jobIssueCategoryLabel(issue.category)}).`,
      },
    })
    .catch((e) => console.error("setJobIssueStatus: log failed", e));

  revalidatePath("/admin/issues");
  revalidatePath(`/admin/jobs/${issue.jobId}`);

  return { ok: true, status: next };
}

/**
 * How many issues still need somebody. Drives the sidebar badge, so it never
 * throws — a count is not worth a 500 on every admin page.
 */
export async function countOpenJobIssues(): Promise<number> {
  try {
    // Derived from the union rather than listed, so a fourth status is counted
    // or excluded by `isOpenIssueStatus` alone and not by a second list here.
    return await db.jobIssue.count({
      where: { status: { in: JOB_ISSUE_STATUSES.filter(isOpenIssueStatus) } },
    });
  } catch {
    return 0;
  }
}
