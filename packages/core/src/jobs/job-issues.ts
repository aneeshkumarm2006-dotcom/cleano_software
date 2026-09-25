// What a cleaner can report from a job, and what happens to it afterwards.
//
// PURE — no DB imports. The cleaner's report form and the admin's issue list
// both import these, and one of them is a client component; anything that
// reaches for `@/lib/org-db` or `next/headers` here would drag the server into
// the browser bundle.
//
// The categories are a TS union rather than a Prisma enum on purpose, the same
// call `JobPhotoKind` documents next door and `Notification.severity` made by
// skipping the enum entirely: widening a Postgres enum costs a migration and a
// deploy, widening a union costs one line. Nothing in the database validates
// these values, so every reader goes through `parse*` below — which is why none
// of them throw.

/** What the report is about. Stored as text in `JobIssue.category`. */
export type JobIssueCategory =
  | "ACCESS"
  | "SUPPLIES"
  | "PROPERTY"
  | "SCOPE"
  | "SAFETY"
  | "CLIENT"
  | "OTHER";

/**
 * Display order for the picker, roughly "what stops the job" first and the
 * catch-all last. OTHER stays at the end so it is never the easy first tap.
 */
export const JOB_ISSUE_CATEGORIES: readonly JobIssueCategory[] = [
  "ACCESS",
  "SUPPLIES",
  "PROPERTY",
  "SCOPE",
  "SAFETY",
  "CLIENT",
  "OTHER",
] as const;

/** The value a report gets when nobody said. */
export const DEFAULT_JOB_ISSUE_CATEGORY: JobIssueCategory = "OTHER";

export const JOB_ISSUE_CATEGORY_LABEL: Record<JobIssueCategory, string> = {
  ACCESS: "Can't get in",
  SUPPLIES: "Supplies or equipment",
  PROPERTY: "Property damage",
  SCOPE: "Job is bigger than booked",
  SAFETY: "Safety",
  CLIENT: "Problem with the client",
  OTHER: "Something else",
};

/**
 * One line of plain English per option, shown under the label on the cleaner's
 * form. A cleaner picking a category on a phone in someone's hallway should not
 * have to guess what "SCOPE" covers.
 */
export const JOB_ISSUE_CATEGORY_HINT: Record<JobIssueCategory, string> = {
  ACCESS: "No key, wrong code, nobody home.",
  SUPPLIES: "Something is missing, empty or broken.",
  PROPERTY: "Damage you found, or damage that happened.",
  SCOPE: "The place needs far more time than the booking allows.",
  SAFETY: "A hazard, an injury, anything unsafe.",
  CLIENT: "Behaviour that needs the office to step in.",
  OTHER: "Anything the office should know about.",
};

export function isJobIssueCategory(v: unknown): v is JobIssueCategory {
  return (
    typeof v === "string" &&
    (JOB_ISSUE_CATEGORIES as readonly string[]).includes(v)
  );
}

/**
 * Parse a submitted value into a column value. Never throws and never rejects:
 * a report that arrived with a mangled category is still a cleaner telling the
 * office something, and losing it to a validation error is strictly worse than
 * filing it under OTHER where an admin can re-file it.
 */
export function parseJobIssueCategory(v: unknown): JobIssueCategory {
  if (typeof v !== "string") return DEFAULT_JOB_ISSUE_CATEGORY;
  const up = v.trim().toUpperCase();
  return isJobIssueCategory(up) ? up : DEFAULT_JOB_ISSUE_CATEGORY;
}

/** Human label for a stored value, safe on anything the column holds. */
export function jobIssueCategoryLabel(v: unknown): string {
  return JOB_ISSUE_CATEGORY_LABEL[parseJobIssueCategory(v)];
}

/**
 * How fast the office has to look. Two values, not five: a scale a cleaner has
 * to interpret gets used as a mood ring, and then nothing on it means anything.
 * URGENT has one meaning — "I am blocked right now".
 */
export type JobIssueUrgency = "NORMAL" | "URGENT";

export const JOB_ISSUE_URGENCY_LABEL: Record<JobIssueUrgency, string> = {
  NORMAL: "Normal",
  URGENT: "Urgent — I'm blocked",
};

export function isJobIssueUrgency(v: unknown): v is JobIssueUrgency {
  return v === "NORMAL" || v === "URGENT";
}

/** Falls back to NORMAL: nothing should escalate itself by arriving malformed. */
export function parseJobIssueUrgency(v: unknown): JobIssueUrgency {
  if (typeof v !== "string") return "NORMAL";
  const up = v.trim().toUpperCase();
  return isJobIssueUrgency(up) ? up : "NORMAL";
}

/** Where the report has got to. OPEN → ACKNOWLEDGED → RESOLVED. */
export type JobIssueStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export const JOB_ISSUE_STATUSES: readonly JobIssueStatus[] = [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
] as const;

export const JOB_ISSUE_STATUS_LABEL: Record<JobIssueStatus, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  RESOLVED: "Resolved",
};

export function isJobIssueStatus(v: unknown): v is JobIssueStatus {
  return v === "OPEN" || v === "ACKNOWLEDGED" || v === "RESOLVED";
}

/** Falls back to OPEN, which is the state that keeps a row on the admin's list. */
export function parseJobIssueStatus(v: unknown): JobIssueStatus {
  if (typeof v !== "string") return "OPEN";
  const up = v.trim().toUpperCase();
  return isJobIssueStatus(up) ? up : "OPEN";
}

/**
 * Still needs somebody. ACKNOWLEDGED counts as open — an admin having read it
 * is not the same as the cleaner's problem having gone away, and the sidebar
 * badge would lie if it were.
 */
export function isOpenIssueStatus(v: unknown): boolean {
  return parseJobIssueStatus(v) !== "RESOLVED";
}

/**
 * Cap on the free-text description. Long enough for a cleaner to explain what
 * happened, short enough that the column, the notification body and the email
 * are all bounded by the same number instead of three different ones.
 */
export const MAX_ISSUE_DESCRIPTION = 2000;
