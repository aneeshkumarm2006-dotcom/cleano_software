"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendAdminJobIssue } from "@/lib/email";
import {
  jobIssueCategoryLabel,
  MAX_ISSUE_DESCRIPTION,
  parseJobIssueCategory,
  parseJobIssueUrgency,
} from "@/lib/job-issues";

/**
 * A cleaner tells the office something is wrong (Sept 3 fix list, item 1).
 *
 * Before this there was nowhere to put it. A cleaner standing outside a locked
 * door either phoned somebody or wrote a job note nobody was watching, and the
 * only trace afterwards was prose in a timeline with no owner and no state.
 */
export async function reportJobIssue(input: {
  jobId: string;
  category: string;
  urgency: string;
  description: string;
  photoId?: string | null;
}): Promise<{ success: true; issueId: string } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  // Neither of these can be rejected: a report that arrived with a mangled
  // category is still a cleaner telling us something. Both fold to their safe
  // default rather than throwing the report away.
  const category = parseJobIssueCategory(input.category);
  const urgency = parseJobIssueUrgency(input.urgency);

  const description = (input.description ?? "").trim();
  if (description.length === 0) {
    return { success: false, error: "Say what happened before sending." };
  }
  if (description.length > MAX_ISSUE_DESCRIPTION) {
    return {
      success: false,
      error: `Keep it under ${MAX_ISSUE_DESCRIPTION} characters.`,
    };
  }

  try {
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      include: { cleaners: { select: { id: true } } },
    });

    if (!job) {
      return { success: false, error: "Job not found" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const isEmployee = job.employeeId === session.user.id;
    const isCleaner = job.cleaners.some((c) => c.id === session.user.id);

    if (!isAdmin && !isEmployee && !isCleaner) {
      return { success: false, error: "Not authorized for this job" };
    }

    // A photo id is a client-supplied pointer, so it is checked against THIS
    // job before it is stored — otherwise a report could quietly attach any
    // photo in the workspace to a job it does not belong to.
    let photoId: string | null = null;
    let photoUrl: string | null = null;
    if (input.photoId) {
      const photo = await db.jobPhoto.findUnique({
        where: { id: input.photoId },
        select: { id: true, jobId: true, url: true },
      });
      if (photo && photo.jobId === input.jobId) {
        photoId = photo.id;
        photoUrl = photo.url;
      }
    }

    const cleanerName = (session.user as { name?: string }).name || "A cleaner";

    const issue = await db.jobIssue.create({
      data: {
        jobId: input.jobId,
        reportedById: session.user.id,
        reportedByName: cleanerName,
        category,
        urgency,
        description,
        photoId,
        photoUrl,
      },
      select: { id: true },
    });

    const categoryLabel = jobIssueCategoryLabel(category);

    // The job's own timeline should say it too, so "when did we first hear
    // about this?" is answered on the page an admin is already looking at.
    // NOTE_ADDED because it is an internal observation, and the customer
    // portal's log allowlist deliberately excludes that action.
    await db.jobLog
      .create({
        data: {
          jobId: input.jobId,
          userId: session.user.id,
          action: "NOTE_ADDED",
          field: "issue",
          newValue: category,
          description: `${
            urgency === "URGENT" ? "URGENT issue" : "Issue"
          } reported — ${categoryLabel}: ${description}`,
        },
      })
      .catch((e) => console.error("reportJobIssue: log failed", e));

    // Fire-and-forget after the write. The row is the record; a mail server
    // having a bad minute must not be the reason the report is lost.
    sendAdminJobIssue({
      jobId: input.jobId,
      jobNumber: job.jobNumber,
      clientName: job.clientName,
      cleanerName,
      category: categoryLabel,
      urgency,
      description,
      photoUrl,
    }).catch((e) => console.error("reportJobIssue: admin notify failed", e));

    revalidatePath(`/cleaners/my-jobs/${input.jobId}`);
    // The admin job page renders the same rows server-side, so without this an
    // admin watching the job sees a stale timeline until a hard reload.
    revalidatePath(`/admin/jobs/${input.jobId}`);

    return { success: true, issueId: issue.id };
  } catch (error) {
    console.error("Error reporting job issue:", error);
    return { success: false, error: "Failed to report the issue" };
  }
}
