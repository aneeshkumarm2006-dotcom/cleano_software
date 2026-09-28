// A cleaner telling the office something is wrong on a job, and reading back
// their own reports.
//
// The web's reportJobIssue (app/cleaners/my-jobs/[jobId]/reportIssue.ts) is a
// thin adapter over reportJobIssueFor; the phone's POST /jobs/:id/issues uses
// the same function with a freshly uploaded photo key instead of a photo id.
// The rules for the phone are packages/api/src/v1/issues.ts.
import "server-only";

import type { JobIssue, JobIssuesResponse } from "@bookmops/api/v1";
import {
  jobIssueCategoryLabel,
  MAX_ISSUE_DESCRIPTION,
  parseJobIssueCategory,
  parseJobIssueUrgency,
} from "@bookmops/core/jobs";
import type { Prisma } from "@prisma/client";

import { sendAdminJobIssue } from "@/lib/email";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { urgentIssuePush } from "../push/notify";
import { failure, notFound, ok, type Result } from "../result";
import {
  decodeTimeCursor,
  encodeTimeCursor,
  insertJobPhotoTx,
  jobForCrew,
  verifyUploadedKey,
  withJobLocked,
  type Door,
} from "../photos/photos";

export interface ReportIssueInput {
  jobId: string;
  category: string;
  urgency: string;
  description: string;
  /**
   * The web: a photo already uploaded to this job (kind ISSUE), by id. It is
   * checked against the job and silently dropped if it isn't on it.
   */
  photoId?: string | null;
  /**
   * The phone: a signed upload's key, not yet attached. Checked as
   * POST /jobs/:id/photos checks it, and attached as an ISSUE photo in the
   * same transaction as the report.
   */
  photoKey?: string | null;
  orgSlug?: string;
  door: Door;
  now: Date;
}

const ISSUE_SELECT = {
  id: true,
  category: true,
  urgency: true,
  status: true,
  description: true,
  createdAt: true,
  photoId: true,
  photoUrl: true,
  resolutionNote: true,
} satisfies Prisma.JobIssueSelect;

function issueView(r: Prisma.JobIssueGetPayload<{ select: typeof ISSUE_SELECT }>): JobIssue {
  return {
    id: r.id,
    category: r.category as JobIssue["category"],
    urgency: r.urgency as JobIssue["urgency"],
    status: r.status as JobIssue["status"],
    note: r.description,
    reportedAt: r.createdAt.toISOString(),
    hasPhoto: !!(r.photoId || r.photoUrl),
    // Shown to the cleaner once resolved, as the web's job page does.
    resolutionNote: r.status === "RESOLVED" ? r.resolutionNote : null,
  };
}

export async function reportJobIssueFor(
  actor: Actor,
  input: ReportIssueInput,
): Promise<Result<{ issueId: string; issue: JobIssue }>> {
  // Neither of these can be rejected on the web: a report that arrived with a
  // mangled category is still a cleaner telling us something. Both fold to
  // their safe default rather than throwing the report away. (The phone's
  // body is validated against a closed enum before it gets here.)
  const category = parseJobIssueCategory(input.category);
  const urgency = parseJobIssueUrgency(input.urgency);

  const description = (input.description ?? "").trim();
  if (description.length === 0) {
    return failure(400, "VALIDATION_FAILED", "Say what happened before sending.");
  }
  if (description.length > MAX_ISSUE_DESCRIPTION) {
    return failure(400, "VALIDATION_FAILED", `Keep it under ${MAX_ISSUE_DESCRIPTION} characters.`);
  }

  const access = await jobForCrew(actor, input.jobId, input.door);
  if (!access.job) {
    return input.door === "phone"
      ? notFound("This job isn't available.")
      : failure(404, "NOT_FOUND", access.reason === "NOT_FOUND" ? "Job not found" : "Not authorized for this job");
  }
  const job = access.job;

  // The web's photo id is a client-supplied pointer, so it is checked against
  // THIS job before it is stored — otherwise a report could quietly attach any
  // photo in the workspace to a job it does not belong to.
  let photoId: string | null = null;
  let photoUrl: string | null = null;
  if (input.photoId) {
    const photo = await db.jobPhoto.findUnique({
      where: { id: input.photoId },
      select: { id: true, jobId: true, url: true },
    });
    if (photo && photo.jobId === job.id) {
      photoId = photo.id;
      photoUrl = photo.url;
    }
  }

  // The phone's key: every check of an attach, before the transaction (they
  // call Cloudinary). ISSUE photos are exempt from the photo switch.
  let upload: { uploadId: string; url: string } | null = null;
  if (input.photoKey) {
    if (!input.orgSlug) return notFound("This upload isn't available.");
    const verified = await verifyUploadedKey(actor, { orgSlug: input.orgSlug, jobId: job.id, key: input.photoKey });
    if (!verified.ok) return verified;
    upload = { uploadId: verified.value.uploadId, url: verified.value.asset.secureUrl };
  }

  const cleanerName = actor.name || "A cleaner";
  const categoryLabel = jobIssueCategoryLabel(category);
  const logLine = `${urgency === "URGENT" ? "URGENT issue" : "Issue"} reported — ${categoryLabel}: ${description}`;

  let issue: Prisma.JobIssueGetPayload<{ select: typeof ISSUE_SELECT }>;
  if (upload) {
    // The photo and the report land together or not at all.
    const r = await withJobLocked(job.id, actor.organizationId, async (tx, refuse) => {
      const { photo } = await insertJobPhotoTx(
        tx,
        { job, actor, url: upload.url, caption: null, kind: "ISSUE", uploadId: upload.uploadId },
        refuse,
        input.now,
      );
      const created = await tx.jobIssue.create({
        data: {
          jobId: job.id,
          reportedById: actor.userId,
          reportedByName: cleanerName,
          category,
          urgency,
          description,
          photoId: photo.id,
          photoUrl: photo.url,
        },
        select: ISSUE_SELECT,
      });
      // NOTE_ADDED because it is an internal observation, and the customer
      // portal's log allowlist deliberately excludes that action.
      await tx.jobLog.create({
        data: { jobId: job.id, userId: actor.userId, action: "NOTE_ADDED", field: "issue", newValue: category, description: logLine },
      });
      return created;
    });
    if (!r.ok) return r;
    issue = r.value;
  } else {
    issue = await db.jobIssue.create({
      data: {
        jobId: job.id,
        reportedById: actor.userId,
        reportedByName: cleanerName,
        category,
        urgency,
        description,
        photoId,
        photoUrl,
      },
      select: ISSUE_SELECT,
    });
    // The job's own timeline should say it too, so "when did we first hear
    // about this?" is answered on the page an admin is already looking at.
    // As before, a failed log line never loses the report.
    await db.jobLog
      .create({
        data: { jobId: job.id, userId: actor.userId, action: "NOTE_ADDED", field: "issue", newValue: category, description: logLine },
      })
      .catch((e) => console.error("reportJobIssue: log failed", e));
  }

  // After the write. The row is the record; a mail server having a bad minute
  // must not be the reason the report is lost. URGENT and NORMAL both mail at
  // once; URGENT is marked as such in the mail and the office's bell.
  const effects: Effect[] = [
    effect("admin job issue email", () =>
      sendAdminJobIssue({
        jobId: job.id,
        jobNumber: job.jobNumber,
        clientName: job.clientName,
        cleanerName,
        category: categoryLabel,
        urgency,
        description,
        photoUrl: issue.photoUrl,
      }),
    ),
  ];

  if (urgency === "URGENT") effects.push(urgentIssuePush(issue.id, job.id, actor.userId, cleanerName));

  return ok({ issueId: issue.id, issue: issueView(issue) }, effects);
}

export const ISSUE_PAGE_SIZE = 20;

/** The caller's own reports on this job, newest first. Never a teammate's. */
export async function listMyJobIssues(
  actor: Actor,
  jobId: string,
  cursorRaw: string | undefined,
): Promise<Result<JobIssuesResponse>> {
  const cursor = decodeTimeCursor(cursorRaw);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

  const { job } = await jobForCrew(actor, jobId, "phone");
  if (!job) return notFound("This job isn't available.");

  const where: Prisma.JobIssueWhereInput = { jobId: job.id, reportedById: actor.userId };
  const rows = await db.jobIssue.findMany({
    where: cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { createdAt: { lt: new Date(cursor.c) } },
                { createdAt: new Date(cursor.c), id: { lt: cursor.id } },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ISSUE_PAGE_SIZE + 1,
    select: ISSUE_SELECT,
  });
  const more = rows.length > ISSUE_PAGE_SIZE;
  const pageRows = more ? rows.slice(0, ISSUE_PAGE_SIZE) : rows;
  const last = pageRows[pageRows.length - 1];
  return ok({
    items: pageRows.map(issueView),
    nextCursor: more && last ? encodeTimeCursor({ c: last.createdAt.toISOString(), id: last.id }) : null,
  });
}
