import { z } from "zod";

import { Cents, Instant, LocalDate, openEnum, page } from "./common";
import { CLOCK_STATES, JOB_STATUSES } from "./enums";

/** A job as a list shows it. */
export const JobSummary = z.object({
  id: z.string(),
  startsAt: Instant,
  endsAt: Instant.nullable(),
  address: z.object({
    line1: z.string(),
    /** Unit, apartment, buzzer. */
    line2: z.string().nullable(),
    /** Neighbourhood or city, for a glance. */
    area: z.string().nullable(),
  }),
  service: z.object({
    /** Canonical category key ("DEEP", "MOVE_IN", …); open-ended on purpose. */
    category: z.string(),
    /** What to show: "Deep clean". */
    label: z.string(),
  }),
  /** This cleaner's pay for the job, when it's known in advance. */
  payCents: Cents.nullable(),
  status: openEnum(JOB_STATUSES),
  clock: z.object({
    state: openEnum(CLOCK_STATES),
    /** Set while clocked in. */
    clockedInAt: Instant.nullable(),
  }),
});
export type JobSummary = z.infer<typeof JobSummary>;

/** GET /api/v1/today — the Today screen, in one request. */
export const TodayResponse = z.object({
  /** "Today" in the company's zone, not the phone's. */
  date: LocalDate,
  /** The job to act on now: the one clocked into, or the next to start. */
  nextJob: JobSummary.nullable(),
  /** Today's other jobs after `nextJob`, in order. */
  laterToday: z.array(JobSummary),
  week: z.object({
    hours: z.number(),
    jobs: z.number().int(),
    earningsCents: Cents,
  }),
  unread: z.object({
    office: z.number().int(),
    notifications: z.number().int(),
  }),
});
export type TodayResponse = z.infer<typeof TodayResponse>;

export const JOB_SCOPES = ["upcoming", "past"] as const;
export type JobScope = (typeof JOB_SCOPES)[number];

/** GET /api/v1/jobs?scope=upcoming|past&cursor=… */
export const JobsListResponse = page(JobSummary);
export type JobsListResponse = z.infer<typeof JobsListResponse>;

/** GET /api/v1/jobs/:id */
export const JobDetailResponse = JobSummary.extend({
  client: z.object({
    /** First name only: cleaners see who they're meeting, not a record. */
    firstName: z.string().nullable(),
  }),
  /** The part of the office's notes meant for cleaners; billing is stripped. */
  notes: z.string().nullable(),
  checklist: z.object({ done: z.number().int(), total: z.number().int() }),
  crew: z.array(z.object({ id: z.string(), name: z.string(), isLead: z.boolean() })),
  /** Scheduled length in minutes, for the clock screen's progress ring. */
  plannedMinutes: z.number().int().nullable(),
});
export type JobDetailResponse = z.infer<typeof JobDetailResponse>;
