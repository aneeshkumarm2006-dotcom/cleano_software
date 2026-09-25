// What the office should know about: the notification feed, late arrivals,
// and problems cleaners have reported.
//
// Replaces, for the phone, the web's /admin/notifications feed
// (lib/admin-notifications.ts), the late-arrival email (clockIn.ts,
// sendAdminLateArrival) and /admin/issues (actions/jobIssues.ts). Access
// follows ./manager-access.ts, and every rule at the bottom of that file
// applies.
//
// No-shows: the web has no "cleaner didn't turn up" alert. Its markNoShow is
// the CUSTOMER's no-show fee. A cleaner who hasn't clocked in after the
// start shows as LATE on the team's day (manager-team.ts), live, which is
// the only form the web's rules give it.
import { z } from "zod";

import { Instant, openEnum, page } from "./common";
import { JOB_ISSUE_CATEGORIES, JOB_ISSUE_STATUSES, JOB_ISSUE_URGENCIES, MAX_ISSUE_NOTE } from "./issues";

// ---- The feed ---------------------------------------------------------------------

/**
 * What an alert is about, mapped by the server from the feed's catalogue key
 * (Notification.notificationKey). Keys with no mapping come through as OTHER,
 * and a kind added later as UNKNOWN; both are shown by their title.
 */
export const ALERT_KINDS = [
  "SHIFT_DROPPED", // admin.shift.dropped
  "COVER_NEEDED", // admin.shift.dropped_urgent
  "CLOCK_LEFT_RUNNING", // admin.clock.left_running
  "CLOCK_FAILED", // admin.clock.clock_in_failed, admin.clock.clock_out_failed
  "JOBS_UNASSIGNED", // admin.jobs.unassigned_by_deactivation
  "TIME_CHANGE_REQUESTED", // admin.timelog.change_requested
  "ISSUE_REPORTED", // admin.job.issue_reported
  "CLOCKED_IN", // admin.clock.clocked_in
  "CLOCKED_OUT", // admin.clock.clocked_out
  "OTHER",
] as const;
export const ALERT_SEVERITIES = ["INFO", "WARN", "ERROR"] as const;

/**
 * The only kinds a FIELD_LEAD's feed carries, and only about a job in their
 * group. Each is about a crew's day that a lead coordinates. Left out: a
 * reported problem (ISSUE_REPORTED; problems are ISSUES, which leads don't
 * have), jobs freed by a deactivation (an office matter), time-change
 * requests (the lead's Clock queue already lists their group's), and OTHER
 * and anything newer, which a lead gets only once it is added here.
 */
export const FIELD_LEAD_ALERT_KINDS = [
  "SHIFT_DROPPED",
  "COVER_NEEDED",
  "CLOCK_LEFT_RUNNING",
  "CLOCK_FAILED",
  "CLOCKED_IN",
  "CLOCKED_OUT",
] as const satisfies readonly (typeof ALERT_KINDS)[number][];

export const Alert = z.object({
  id: z.string(),
  kind: openEnum(ALERT_KINDS),
  severity: openEnum(ALERT_SEVERITIES),
  title: z.string(),
  body: z.string().nullable(),
  createdAt: Instant,
  /** Has the caller opened it: each person has their own read state, as on the web. */
  read: z.boolean(),
  /**
   * The job it is about, parsed by the server from the feed row's href
   * (`/admin/jobs/:id`), and only when that job is in the caller's scope.
   * The href itself is never sent: it is a web path, and the phone opens
   * its own screen for the job.
   */
  jobId: z.string().nullable(),
});
export type Alert = z.infer<typeof Alert>;

/**
 * GET /api/v1/manager/alerts?cursor= — the feed, newest first, less what the
 * caller archived on the web (listAdminNotifications). Keyset-paged.
 *
 * Access: ALERTS.
 *   - OWNER, ADMIN, OPS_MANAGER: the company's feed, as every admin role
 *     reads it on the web. `unreadCount` is
 *     countUnreadAdminNotifications(caller).
 *   - FIELD_LEAD: narrower than the web, which shows a lead the whole
 *     company's feed. Only rows whose kind is in FIELD_LEAD_ALERT_KINDS AND
 *     whose job (parsed from the row's href, as `jobId`) is in the lead's
 *     group (fieldLeadScopedJobsWhere); a row with no job, or another
 *     group's, is never sent. The catalogue's `title` and `body` are written
 *     for the office and can carry a client's full name, so a lead gets a
 *     title the server builds from the kind, the cleaner's name and the job
 *     number (e.g. "Cover needed · job #1434"), and `body` null.
 *     `unreadCount` counts those rows only, and
 *     POST …/alerts/read ignores any id outside them.
 */
export const AlertsResponse = page(Alert).extend({ unreadCount: z.number().int() });
export type AlertsResponse = z.infer<typeof AlertsResponse>;

/**
 * POST /api/v1/manager/alerts/read — mark these read for the caller only.
 * Idempotent by nature (the unique (notification, user) read row). Unknown
 * ids and other companies' ids are ignored. At most 200.
 */
export const MarkAlertsReadRequest = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) });
export type MarkAlertsReadRequest = z.infer<typeof MarkAlertsReadRequest>;
export const MarkAlertsReadResponse = z.object({ unreadCount: z.number().int() });

// ---- Late arrivals -------------------------------------------------------------------

export const LateArrival = z.object({
  /** The assignment's id (or the job's, for a job with no per-cleaner rows). */
  id: z.string(),
  job: z.object({ id: z.string(), jobNumber: z.number().int(), startsAt: Instant, area: z.string().nullable() }),
  cleaner: z.object({ id: z.string(), name: z.string() }),
  clockedInAt: Instant,
  minutesLate: z.number().int(),
  /** Stars the job's rating loses (computeLateArrivalPenalty). */
  ratingPenalty: z.number().nullable(),
  /** 45 minutes or more: the "LATE_45" strike clockIn applies. */
  strike: z.boolean(),
});
export type LateArrival = z.infer<typeof LateArrival>;

/**
 * GET /api/v1/manager/late-arrivals?cursor= — the last 30 days, newest first.
 *
 * Exactly the arrivals the web emails the office about (sendAdminLateArrival
 * in clockIn.ts): read from the lateArrivalAt and lateArrivalRatingPenalty
 * clockIn already writes, so nothing new is recorded and the two can't
 * disagree. Flexible jobs never appear (they can't be late).
 *
 * Access: ALERTS. A FIELD_LEAD sees their group's (manager-access.ts rule
 * 3); OWNER, ADMIN and OPS_MANAGER see the company's, since the web emails
 * each one to the whole office. The rows name the job's area, never its
 * client.
 */
export const LateArrivalsResponse = page(LateArrival);
export type LateArrivalsResponse = z.infer<typeof LateArrivalsResponse>;

// ---- Problems cleaners reported ------------------------------------------------------

export const ManagedIssue = z.object({
  id: z.string(),
  job: z.object({
    id: z.string(),
    jobNumber: z.number().int(),
    clientName: z.string(),
    startsAt: Instant,
  }),
  reportedBy: z.string(),
  category: openEnum(JOB_ISSUE_CATEGORIES),
  urgency: openEnum(JOB_ISSUE_URGENCIES),
  status: openEnum(JOB_ISSUE_STATUSES),
  note: z.string(),
  /** https on the company's own storage, or null. The server drops any other URL. */
  photoUrl: z.string().nullable(),
  reportedAt: Instant,
  acknowledgedAt: Instant.nullable(),
  resolvedAt: Instant.nullable(),
  resolvedBy: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});
export type ManagedIssue = z.infer<typeof ManagedIssue>;

/**
 * GET /api/v1/manager/issues?status=open|resolved&cursor= — open is OPEN and
 * ACKNOWLEDGED (isOpenIssueStatus: someone having read it is not the problem
 * having gone away), URGENT first, then newest; resolved is newest first.
 *
 * Access: ISSUES (OWNER, ADMIN; jobIssues.ts requireOwnerAdmin).
 */
export const IssuesResponse = page(ManagedIssue).extend({ openCount: z.number().int() });
export type IssuesResponse = z.infer<typeof IssuesResponse>;

/** GET /api/v1/manager/issues/:id */
export const IssueResponse = ManagedIssue;

/**
 * POST /api/v1/manager/issues/:id/status — move an issue along. Idempotent
 * on `clientEventId`.
 *
 * Access: ISSUES. As setJobIssueStatus: ACKNOWLEDGED keeps the first
 * acknowledgement time; RESOLVED stamps resolvedAt and resolvedBy (the
 * caller) with the note (trimmed, at most MAX_ISSUE_NOTE); OPEN reopens and
 * clears the resolution. Writes the JobLog line with the actor. The note is
 * what the cleaner sees on their report (issues.ts `resolutionNote`).
 * `resolutionNote` is required to RESOLVE from the phone (400
 * NOTE_REQUIRED); the web allows it empty, but a cleaner told "resolved"
 * with no word of what was done has to ask.
 * Response: the issue as it now stands.
 */
export const IssueStatusRequest = z.object({
  status: z.enum(JOB_ISSUE_STATUSES),
  resolutionNote: z.string().trim().max(MAX_ISSUE_NOTE).optional(),
  clientEventId: z.uuid(),
});
export type IssueStatusRequest = z.infer<typeof IssueStatusRequest>;
