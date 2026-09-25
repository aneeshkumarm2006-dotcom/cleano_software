// Reporting a problem on a job: locked out, supplies missing, damage, a job
// far bigger than booked. The web's version is
// apps/web/src/app/cleaners/my-jobs/[jobId]/reportIssue.ts; the vocabulary is
// packages/core/src/jobs/job-issues.ts, copied and frozen here.
import { z } from "zod";

import { Instant, openEnum, page } from "./common";

/** What the report is about, in the order the picker shows them. */
export const JOB_ISSUE_CATEGORIES = ["ACCESS", "SUPPLIES", "PROPERTY", "SCOPE", "SAFETY", "CLIENT", "OTHER"] as const;
export type JobIssueCategory = (typeof JOB_ISSUE_CATEGORIES)[number];

/** How fast the office has to look. URGENT means "I'm blocked right now". */
export const JOB_ISSUE_URGENCIES = ["NORMAL", "URGENT"] as const;
export type JobIssueUrgency = (typeof JOB_ISSUE_URGENCIES)[number];

/** OPEN → ACKNOWLEDGED → RESOLVED. */
export const JOB_ISSUE_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

/** The web's cap on the description (core `MAX_ISSUE_DESCRIPTION`). */
export const MAX_ISSUE_NOTE = 2000;

/**
 * POST /api/v1/jobs/:id/issues
 *
 * Idempotent on `clientEventId` (also the Idempotency-Key): a retry after a
 * dropped connection returns the first report, and never files a second one
 * or sends a second email.
 *
 * The server must:
 *   - check the caller is assigned to the job (404 otherwise). Reporting stays
 *     open before, during and after the shift, as on the web;
 *   - trim the note and refuse it empty or over MAX_ISSUE_NOTE (400);
 *   - for `photoKey`, apply every check of POST /jobs/:id/photos (this
 *     company, this job, this caller's prefix; the object exists) and attach
 *     it as an ISSUE photo in the same transaction as the report. ISSUE photos
 *     are exempt from the job's photo switch and don't send the "photos added"
 *     email, as on the web;
 *   - write the job-log line and email the office, as the web does. URGENT is
 *     emailed straight away.
 */
export const ReportIssueRequest = z.object({
  category: z.enum(JOB_ISSUE_CATEGORIES),
  urgency: z.enum(JOB_ISSUE_URGENCIES),
  note: z.string().trim().min(1).max(MAX_ISSUE_NOTE),
  /** A signed upload's key (POST /uploads, purpose JOB_PHOTO), not yet attached. */
  photoKey: z.string().min(1).max(512).nullable().optional(),
  clientEventId: z.uuid(),
});
export type ReportIssueRequest = z.infer<typeof ReportIssueRequest>;

/** A report as the cleaner who made it sees it. */
export const JobIssue = z.object({
  id: z.string(),
  category: openEnum(JOB_ISSUE_CATEGORIES),
  urgency: openEnum(JOB_ISSUE_URGENCIES),
  status: openEnum(JOB_ISSUE_STATUSES),
  note: z.string(),
  reportedAt: Instant,
  hasPhoto: z.boolean(),
  /** The office's answer, once it's resolved. Written for the cleaner. */
  resolutionNote: z.string().nullable(),
});
export type JobIssue = z.infer<typeof JobIssue>;

/**
 * GET /api/v1/jobs/:id/issues?cursor=…
 *
 * The CALLER's own reports on this job, newest first — what the web's job page
 * lists under "Something wrong?". Never a teammate's reports, and never the
 * office's internal notes on them. 404 unless assigned.
 */
export const JobIssuesResponse = page(JobIssue);
export type JobIssuesResponse = z.infer<typeof JobIssuesResponse>;
