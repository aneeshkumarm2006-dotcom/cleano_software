// The team's day, one job as the office sees it, and changing who is on it.
//
// Replaces, for the phone, the operational half of the web's dashboard and
// calendar (app/admin/dashboard/page.tsx, actions/getJobsForDay.ts,
// actions/getJobSummary.ts, actions/getMyTeam.ts) and its two assignment
// paths (actions/assignCleaners.ts, actions/bulkAssignCleaner.ts, with the
// warnings of actions/checkAvailability.ts). Access and scope follow
// ./manager-access.ts; every rule listed at the bottom of that file applies.
import { z } from "zod";

import { Instant, LocalDate, openEnum } from "./common";
import { JOB_STATUSES } from "./enums";
import { JOB_ISSUE_CATEGORIES, JOB_ISSUE_STATUSES, JOB_ISSUE_URGENCIES } from "./issues";
import { JOB_PHOTO_KINDS } from "./photos";

// ---- Vocabularies (frozen copies; see enums.ts) ----------------------------

/**
 * Where one crew member stands on one job right now, as the server computes
 * it from their work sessions and breaks:
 *   NOT_STARTED  not clocked in, and the job hasn't started yet (or is flexible);
 *   LATE         not clocked in, the scheduled start has passed, and the job
 *                isn't flexible — the web's rule in clockIn.ts, where a
 *                FLEXIBLE job can never be late;
 *   CLOCKED_IN   a session is open;
 *   ON_BREAK     a session is open and so is a break;
 *   DONE         clocked out, no session open.
 */
export const CREW_STATES = ["NOT_STARTED", "LATE", "CLOCKED_IN", "ON_BREAK", "DONE"] as const;
export type CrewState = (typeof CREW_STATES)[number];

/** Where a crew member's assignment stands (JobCleanerStatus). */
export const ASSIGNMENT_STATUSES = ["ASSIGNED", "ON_THE_WAY", "CLOCKED_IN", "CLOCKED_OUT", "COMPLETED", "CANCELLED"] as const;

/** What about a job needs the office. Sorted by the server, most pressing first. */
export const JOB_ATTENTION = ["UNASSIGNED", "SHORT_STAFFED", "LATE_START", "ISSUE_OPEN"] as const;
export type JobAttention = (typeof JOB_ATTENTION)[number];

/** The web's four answers for "does this job fit this person's availability" (lib/availability.ts). */
export const AVAILABILITY_RESULTS = ["AVAILABLE", "UNAVAILABLE", "OUTSIDE_HOURS", "NO_DATA"] as const;

/** A cleaner's seniority tier: drives dispatch and trainee pairing, never shown as pay. */
export const CLEANER_TIERS = ["TRAINEE", "STANDARD", "FIELD_LEAD"] as const;

/** One clock event on a job, for the office's record of it. */
export const CLOCK_EVENT_KINDS = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;

// ---- The day ------------------------------------------------------------------

export const CrewMember = z.object({
  id: z.string(),
  name: z.string(),
  /** The job's lead (Job.employeeId). */
  isLead: z.boolean(),
  tier: openEnum(CLEANER_TIERS),
  state: openEnum(CREW_STATES),
  assignment: openEnum(ASSIGNMENT_STATUSES),
  /** The current (or last) session's start, while clocked in, on a break, or done. */
  clockedInAt: Instant.nullable(),
  clockedOutAt: Instant.nullable(),
  /**
   * Minutes after the scheduled start they clocked in, as clockIn.ts measured
   * it on their first session (0 on time, null if not in yet or flexible).
   */
  minutesLate: z.number().int().nullable(),
});
export type CrewMember = z.infer<typeof CrewMember>;

/** A job on the team's day. */
export const TeamJob = z.object({
  id: z.string(),
  jobNumber: z.number().int(),
  startsAt: Instant,
  endsAt: Instant.nullable(),
  /** A flexible job's start is only a slot on the day; it is never late. */
  isFlexible: z.boolean(),
  status: openEnum(JOB_STATUSES),
  address: z.object({
    /**
     * The street. NULL for a FIELD_LEAD on a job they aren't on themselves:
     * My Team shows a lead the area, never the street (getMyTeam.types.ts).
     */
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    area: z.string().nullable(),
  }),
  client: z.object({
    /** The full name for JOB_CONTACT roles; the first name only for a FIELD_LEAD. */
    name: z.string(),
  }),
  service: z.object({ category: z.string(), label: z.string() }),
  staffing: z.object({
    /** Job.requiredCleaners. */
    required: z.number().int(),
    /** The lead plus the crew, counted once each (lib/cleaner-jobs.ts jobStaffing). */
    assigned: z.number().int(),
  }),
  crew: z.array(CrewMember),
  /** What needs the office, most pressing first. Empty when all is well. */
  attention: z.array(openEnum(JOB_ATTENTION)),
});
export type TeamJob = z.infer<typeof TeamJob>;

/**
 * GET /api/v1/manager/team/day?date=YYYY-MM-DD — every job on one day, in
 * start order, with its crew's live state. `date` defaults to today in the
 * company's zone. Serves the Today tab (polled every 60 s while on screen)
 * and the Schedule tab (one day at a time).
 *
 * Access: TEAM_VIEW. Scope: COMPANY, or the caller's GROUP for a FIELD_LEAD
 * (rule 3). Jobs are those getJobsForDay would return for the day in the
 * company's zone, less archived (deletedAt) jobs; CANCELLED jobs are left
 * out. `date` more than 400 days from today answers 400.
 *
 * `people` is one line per person with work that day (a person on two jobs
 * appears once, at their most pressing state: LATE, ON_BREAK, CLOCKED_IN,
 * NOT_STARTED, DONE), for the "who is where" summary.
 */
export const TeamDayResponse = z.object({
  date: LocalDate,
  scope: openEnum(["COMPANY", "GROUP"] as const),
  jobs: z.array(TeamJob),
  people: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      state: openEnum(CREW_STATES),
      /** The job that state is about. */
      jobId: z.string(),
    }),
  ),
});
export type TeamDayResponse = z.infer<typeof TeamDayResponse>;

// ---- One job --------------------------------------------------------------------

export const ClockEventRecord = z.object({
  kind: openEnum(CLOCK_EVENT_KINDS),
  cleanerId: z.string(),
  cleanerName: z.string(),
  /** The time that counts: the applied one, after any office correction. */
  at: Instant,
  /** Sent from a phone that was offline and still waiting on the office (§6). */
  pendingReview: z.boolean(),
});
export type ClockEventRecord = z.infer<typeof ClockEventRecord>;

export const JobPhotoRecord = z.object({
  id: z.string(),
  kind: openEnum(JOB_PHOTO_KINDS),
  /** https, on the company's own storage (API_V1.md §4 "Only stored URLs go out"). */
  url: z.string(),
  takenBy: z.string(),
  takenAt: Instant,
});

export const JobIssueRecord = z.object({
  id: z.string(),
  category: openEnum(JOB_ISSUE_CATEGORIES),
  urgency: openEnum(JOB_ISSUE_URGENCIES),
  status: openEnum(JOB_ISSUE_STATUSES),
  note: z.string(),
  reportedBy: z.string(),
  reportedAt: Instant,
});

/**
 * GET /api/v1/manager/jobs/:id — one job for the office.
 *
 * Access: TEAM_VIEW, and the job in the caller's scope (else 404).
 *
 * Sections the caller's role can't see are NULL, never empty, so the app
 * can tell "none" from "not yours to see":
 *   - `client.phone`/`client.email`: JOB_CONTACT only;
 *   - `clockEvents`, `photos`, `checklist`, `issues`: JOB_RECORDS only.
 * `notes` is the office's note as the web's getJobSummary gives it to OWNER
 * and ADMIN; for every other role it goes through sanitizeCleanerNotes, so
 * no billing line reaches them (_calendarScope.ts).
 * `can` says which crew changes this caller may make, from capabilitiesFor
 * and the job's state (none on an archived job, which the web refuses too).
 */
export const ManagerJobResponse = TeamJob.extend({
  client: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  notes: z.string().nullable(),
  clockEvents: z.array(ClockEventRecord).nullable(),
  photos: z.array(JobPhotoRecord).nullable(),
  /** Across the crew's checklists: items done of items total. */
  checklist: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
  issues: z.array(JobIssueRecord).nullable(),
  can: z.object({
    /** Assign, unassign and reassign: PUT …/crew. */
    setCrew: z.boolean(),
    /** Add one cleaner: POST …/cleaners. */
    addCleaner: z.boolean(),
  }),
});
export type ManagerJobResponse = z.infer<typeof ManagerJobResponse>;

// ---- Who could work it ------------------------------------------------------------

export const Candidate = z.object({
  id: z.string(),
  name: z.string(),
  tier: openEnum(CLEANER_TIERS),
  /** Already on this job. */
  onJob: z.boolean(),
  availability: openEnum(AVAILABILITY_RESULTS),
  /** True when the conflict is a one-off blocked date (a day off). */
  dayOff: z.boolean(),
  /**
   * The web's own warning lines, ready to show, or empty: availabilityWarning
   * (outside hours, day off) and categoryMismatchWarning (not approved for
   * this service). Advisory: the office may override, as on the web.
   */
  warnings: z.array(z.string()),
});
export type Candidate = z.infer<typeof Candidate>;

/**
 * GET /api/v1/manager/jobs/:id/candidates — who could be put on this job.
 *
 * Access: CREW_SET or CREW_ADD (else 403), and the job in scope (else 404).
 * Everyone listAssignableCleaners would list (EMPLOYEE and FIELD_LEAD, active,
 * not deleted, this company), evaluated against the job's window with
 * evaluateEmployeesAvailability (recurring availability plus days off) and
 * findCategoryConflicts, in one pass. Order: on the job, then AVAILABLE, then
 * NO_DATA, then conflicts; by name within each. At most 500.
 */
export const CandidatesResponse = z.object({
  jobId: z.string(),
  candidates: z.array(Candidate),
});
export type CandidatesResponse = z.infer<typeof CandidatesResponse>;

/** Why a crew change was refused: the `error.code`. */
export const CREW_REFUSALS = [
  /** 409: a trainee would work without an approved cleaner or lead (validateTraineePairing). */
  "TRAINEE_UNPAIRED",
  /** 409: CREW_ADD can't add a trainee alone (bulkAssignCleaner); it is done from a full crew change. */
  "TRAINEE_NEEDS_CREW",
  /** 409: the job is archived: "This booking is no longer active." (assignCleaners.ts) */
  "JOB_CLOSED",
  /** 409: the crew changed since the caller loaded it (`expectedCrewIds`). */
  "CREW_CHANGED",
  /** 409: the office hasn't confirmed the warnings it was shown (`acknowledgedWarnings`). */
  "WARNINGS_NOT_ACKNOWLEDGED",
] as const;

/**
 * PUT /api/v1/manager/jobs/:id/crew — set who is on the job: assign,
 * unassign and reassign in one call. Idempotent on `clientEventId`.
 *
 * Access: CREW_SET (OWNER, ADMIN; assignCleaners.ts). The job in this
 * company, else 404; archived, 409 JOB_CLOSED. Every id must be an active
 * EMPLOYEE or FIELD_LEAD of this company, else 400 (no hint which id).
 *
 * The server does exactly what assignCleaners does, in one transaction:
 *   - refuses a trainee-only crew (409 TRAINEE_UNPAIRED, the web's message);
 *   - refuses when the crew on record isn't `expectedCrewIds` (409
 *     CREW_CHANGED), so two managers can't overwrite each other unseen;
 *   - recomputes the availability and category warnings; if there are any
 *     and `acknowledgedWarnings` isn't true, refuses with 409
 *     WARNINGS_NOT_ACKNOWLEDGED (the app always shows them first, so this
 *     only catches a stale screen). With it true they are overridden, as the
 *     web allows, and each is written to the JobLog ("… overridden — …");
 *   - sets the crew, keeps the lead a real member (resolveJobLead), syncs the
 *     JobAssignment rows, and writes the JobLog line with the actor.
 * Effects (after commit, never on a replay): the client's "booking confirmed"
 * or "booking modified" email per the job's notifyClient, the office's
 * "modified" email, accept/decline invites for newly added cleaners, and
 * their push alert per notifyProvider — all as the web sends them.
 * Rate limit: crew changes (manager-access.ts rule 7).
 * Response: the job as GET /manager/jobs/:id, and the warnings overridden.
 */
export const SetCrewRequest = z.object({
  cleanerIds: z.array(z.string().min(1).max(64)).max(20),
  /** The crew the caller saw, in any order. */
  expectedCrewIds: z.array(z.string().min(1).max(64)).max(20),
  acknowledgedWarnings: z.boolean(),
  clientEventId: z.uuid(),
});
export type SetCrewRequest = z.infer<typeof SetCrewRequest>;

export const CrewChangeResponse = z.object({
  job: ManagerJobResponse,
  /** The warnings that applied and were overridden, for the confirmation. */
  overridden: z.array(z.string()),
});
export type CrewChangeResponse = z.infer<typeof CrewChangeResponse>;

/**
 * POST /api/v1/manager/jobs/:id/cleaners — add one cleaner to the job, as
 * the web's bulk "Assign cleaner" does for one job. Idempotent on
 * `clientEventId`; adding someone already on it changes nothing.
 *
 * Access: CREW_ADD (OWNER, ADMIN, OPS_MANAGER; bulkAssignCleaner.ts). No
 * unassigning here: the web gives OPS_MANAGER no way to remove anyone.
 * The cleaner must be an active EMPLOYEE or FIELD_LEAD of this company (else
 * 404). A trainee answers 409 TRAINEE_NEEDS_CREW with the web's message.
 * Warnings and `acknowledgedWarnings` work as for PUT …/crew. Connects the
 * cleaner, sets them as lead if the job has none, upserts their
 * JobAssignment (ASSIGNED), and writes the JobLog line with any overrides.
 * No emails: the web's bulk path sends none, and this is that path.
 */
export const AddCleanerRequest = z.object({
  cleanerId: z.string().min(1).max(64),
  acknowledgedWarnings: z.boolean(),
  clientEventId: z.uuid(),
});
export type AddCleanerRequest = z.infer<typeof AddCleanerRequest>;
