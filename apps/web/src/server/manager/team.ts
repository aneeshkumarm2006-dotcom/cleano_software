// The team's day and one job as the office sees it
// (packages/api/src/v1/manager-team.ts: GET /manager/team/day, GET /manager/jobs/:id).
//
// Built from the web's own pieces: the day is getJobsForDay's (jobDate or
// start inside the company's day), the scope is _calendarScope's widened as
// dayScopeFor says, the head-count is jobStaffing's, the address is the
// resolver the cleaner screens use, and "late" is clockIn's rule (a flexible
// job is never late). Nothing here carries money (manager-access.ts rule 4):
// no price, pay, tip or payment state is selected at all.
import "server-only";

import type { ManagerJobResponse, TeamDayResponse, TeamJob } from "@bookmops/api/v1";
import { can, dayScopeFor, type DayScope } from "@bookmops/api/v1";
import { isOpenIssueStatus, JOB_ISSUE_STATUSES, sanitizeCleanerNotes } from "@bookmops/core/jobs";
import { resolveAddressParts } from "@bookmops/core/property";
import { jobTypeLabel, normalizeJobType } from "@bookmops/core/services";
import type { Prisma } from "@prisma/client";

import { jobStaffing } from "@/lib/cleaner-jobs";
import { db } from "@/lib/org-db";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { storeCivilDayRange } from "@/lib/timezone";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Result } from "../result";
import { clientNameFor, isOnToday, managerView, scopeForDay, scopeWhere, type ManagerView } from "./scope";

const OPEN_ISSUE_STATUSES = JOB_ISSUE_STATUSES.filter(isOpenIssueStatus);

/** The furthest from today a day may be asked for. */
const MAX_DAY_DISTANCE = 400;
/** A day with more jobs than this is cut off; no company has one. */
const MAX_DAY_JOBS = 500;

export const TEAM_JOB_SELECT = {
  id: true,
  jobNumber: true,
  startTime: true,
  endTime: true,
  jobDate: true,
  isFlexible: true,
  status: true,
  deletedAt: true,
  location: true,
  aptNumber: true,
  postalCode: true,
  jobType: true,
  clientName: true,
  requiredCleaners: true,
  employeeId: true,
  clientAddress: { select: { aptNumber: true, city: true, postalCode: true } },
  employee: { select: { id: true, name: true, cleanerTier: true } },
  cleaners: { select: { id: true, name: true, cleanerTier: true }, orderBy: { name: "asc" } },
  workSessions: {
    select: { id: true, cleanerId: true, startedAt: true, endedAt: true },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  },
  breaks: { select: { id: true, cleanerId: true, startedAt: true, endedAt: true }, orderBy: { startedAt: "asc" } },
  assignments: { select: { cleanerId: true, status: true } },
  _count: { select: { issues: { where: { status: { in: OPEN_ISSUE_STATUSES } } } } },
} satisfies Prisma.JobSelect;

export type TeamJobRow = Prisma.JobGetPayload<{ select: typeof TEAM_JOB_SELECT }>;

type CrewState = "NOT_STARTED" | "LATE" | "CLOCKED_IN" | "ON_BREAK" | "DONE";

/** Most pressing first, for `people` and for LATE_START. */
const STATE_RANK: Record<CrewState, number> = { LATE: 0, ON_BREAK: 1, CLOCKED_IN: 2, NOT_STARTED: 3, DONE: 4 };

function crewStateOf(job: TeamJobRow, cleanerId: string, now: Date) {
  const sessions = job.workSessions.filter((s) => s.cleanerId === cleanerId);
  const open = sessions.find((s) => !s.endedAt) ?? null;
  const last = sessions[sessions.length - 1] ?? null;
  const first = sessions[0] ?? null;
  let state: CrewState;
  if (open) {
    const onBreak = job.breaks.some((b) => b.cleanerId === cleanerId && !b.endedAt);
    state = onBreak ? "ON_BREAK" : "CLOCKED_IN";
  } else if (last) {
    state = "DONE";
  } else {
    // clockIn.ts: a flexible job's start is only a slot on the day; never late.
    state = !job.isFlexible && now.getTime() > job.startTime.getTime() ? "LATE" : "NOT_STARTED";
  }
  const current = open ?? last;
  const minutesLate =
    first && !job.isFlexible
      ? Math.max(0, Math.floor((first.startedAt.getTime() - job.startTime.getTime()) / 60_000))
      : null;
  return {
    state,
    clockedInAt: current ? current.startedAt.toISOString() : null,
    clockedOutAt: !open && last?.endedAt ? last.endedAt.toISOString() : null,
    minutesLate,
  };
}

interface BuildContext {
  view: ManagerView;
  labels: Record<string, string>;
  now: Date;
}

/** One job as TeamJob, with the lead's outside-group crew reduced to names. */
export function toTeamJob(job: TeamJobRow, ctx: BuildContext): TeamJob {
  const { view, now } = ctx;
  const role = view.actor.role;
  const group = view.groupIds ? new Set(view.groupIds) : null;

  // The lead plus the roster, once each (jobStaffing's union), lead first.
  const people = new Map<string, { id: string; name: string; tier: string }>();
  if (job.employee) people.set(job.employee.id, { id: job.employee.id, name: job.employee.name, tier: job.employee.cleanerTier });
  for (const c of job.cleaners) if (!people.has(c.id)) people.set(c.id, { id: c.id, name: c.name, tier: c.cleanerTier });

  const assignmentOf = new Map(job.assignments.map((a) => [a.cleanerId, a.status]));
  const crew: TeamJob["crew"] = [];
  let anyLate = false;
  for (const p of people.values()) {
    const live = crewStateOf(job, p.id, now);
    // Job-level: the whole crew, outside-group people included.
    if (live.state === "LATE") anyLate = true;
    const outside = !!group && !group.has(p.id);
    crew.push(
      outside
        ? {
            id: p.id,
            name: p.name,
            isLead: job.employeeId === p.id,
            outsideGroup: true,
            tier: null,
            state: null,
            assignment: null,
            clockedInAt: null,
            clockedOutAt: null,
            minutesLate: null,
          }
        : {
            id: p.id,
            name: p.name,
            isLead: job.employeeId === p.id,
            outsideGroup: false,
            tier: p.tier as TeamJob["crew"][number]["tier"],
            state: live.state,
            assignment: (assignmentOf.get(p.id) ?? null) as TeamJob["crew"][number]["assignment"],
            clockedInAt: live.clockedInAt,
            clockedOutAt: live.clockedOutAt,
            minutesLate: live.minutesLate,
          },
    );
  }

  const staffing = jobStaffing(job);
  const attention: TeamJob["attention"] = [];
  if (staffing.assigned === 0) attention.push("UNASSIGNED");
  else if (staffing.isShort) attention.push("SHORT_STAFFED");
  if (anyLate) attention.push("LATE_START");
  // Only for roles that may open the issue: the flag is the issue's existence.
  if (job._count.issues > 0 && can(role, "ISSUES")) attention.push("ISSUE_OPEN");

  const address = resolveAddressParts({
    address: job.location,
    aptNumber: job.aptNumber ?? job.clientAddress?.aptNumber ?? null,
    city: job.clientAddress?.city ?? null,
    postalCode: job.postalCode ?? job.clientAddress?.postalCode ?? null,
  });
  // My Team shows a lead the area, never the street, unless it's their own job.
  const onItThemselves = people.has(view.actor.userId);
  const showStreet = role !== "FIELD_LEAD" || onItThemselves;

  return {
    id: job.id,
    jobNumber: job.jobNumber,
    startsAt: job.startTime.toISOString(),
    endsAt: job.endTime ? job.endTime.toISOString() : null,
    isFlexible: job.isFlexible,
    status: job.status as TeamJob["status"],
    address: {
      line1: showStreet ? address.street || job.location || null : null,
      line2: showStreet ? (address.aptLabel ?? null) : null,
      area: address.city ?? null,
    },
    client: { name: clientNameFor(role, job.clientName) },
    service: {
      category: normalizeJobType(job.jobType) ?? "OTHER",
      label: jobTypeLabel(job.jobType, ctx.labels) || "Cleaning",
    },
    staffing: { required: staffing.required, assigned: staffing.assigned },
    crew,
    attention,
  };
}

/** Days between two company date keys ("2026-09-25"), by the calendar. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** GET /manager/team/day */
export async function teamDayFor(
  actor: Actor,
  date: string | undefined,
  now: Date,
): Promise<Result<TeamDayResponse>> {
  const view = await managerView(actor, now);
  const dateKey = date ?? view.todayKey;
  if (Math.abs(daysBetween(dateKey, view.todayKey)) > MAX_DAY_DISTANCE) {
    return failure(400, "VALIDATION_FAILED", "Pick a date within a year of today.");
  }
  const scope = scopeForDay(view, dateKey);
  if (!scope) return failure(403, "FORBIDDEN", "Your role can't do this.");

  const { start, end } = storeCivilDayRange(dateKey);
  const [rows, { labels }] = await Promise.all([
    db.job.findMany({
      where: {
        AND: [
          { deletedAt: null, status: { not: "CANCELLED" } },
          { OR: [{ jobDate: { gte: start, lt: end } }, { startTime: { gte: start, lt: end } }] },
          scopeWhere(view, scope),
        ],
      },
      select: TEAM_JOB_SELECT,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      take: MAX_DAY_JOBS,
    }),
    getServiceCatalogWithLabels(),
  ]);

  const ctx: BuildContext = { view, labels, now };
  const jobs = rows.map((r) => toTeamJob(r, ctx));

  // One line per person, at their most pressing state across the day.
  const byPerson = new Map<string, TeamDayResponse["people"][number]>();
  for (const j of jobs) {
    for (const c of j.crew) {
      if (c.outsideGroup || !c.state) continue;
      const prev = byPerson.get(c.id);
      const state = c.state as CrewState;
      if (!prev || STATE_RANK[state] < STATE_RANK[prev.state as CrewState]) {
        byPerson.set(c.id, { id: c.id, name: c.name, state, jobId: j.id });
      }
    }
  }
  const people = [...byPerson.values()].sort(
    (a, b) => STATE_RANK[a.state as CrewState] - STATE_RANK[b.state as CrewState] || a.name.localeCompare(b.name),
  );

  return ok({ date: dateKey, scope: scope as DayScope, jobs, people });
}

// ── One job ─────────────────────────────────────────────────────────────────

/** The job's row for the manager, if it is in the caller's view (rule 3). */
async function loadJobInView(view: ManagerView, jobId: string): Promise<TeamJobRow | null> {
  const row = await db.job.findFirst({ where: { id: jobId }, select: TEAM_JOB_SELECT });
  if (!row) return null;
  const scope = dayScopeFor(view.actor.role, isOnToday(view, row));
  if (!scope) return null;
  if (scope === "COMPANY") return row;
  const hit = await db.job.findFirst({ where: { AND: [{ id: row.id }, scopeWhere(view, scope)] }, select: { id: true } });
  return hit ? row : null;
}

export async function managerJobFor(actor: Actor, jobId: string, now: Date): Promise<Result<ManagerJobResponse>> {
  const view = await managerView(actor, now);
  const row = await loadJobInView(view, jobId);
  if (!row) return notFound("This job isn't available.");
  return ok(await buildManagerJob(view, row, now));
}

/** GET /manager/jobs/:id's answer, for the view and after a crew change. */
export async function managerJobById(view: ManagerView, jobId: string, now: Date): Promise<ManagerJobResponse | null> {
  const row = await loadJobInView(view, jobId);
  return row ? buildManagerJob(view, row, now) : null;
}

async function buildManagerJob(view: ManagerView, row: TeamJobRow, now: Date): Promise<ManagerJobResponse> {
  const role = view.actor.role;
  const { labels } = await getServiceCatalogWithLabels();
  const base = toTeamJob(row, { view, labels, now });

  const contact = can(role, "JOB_CONTACT");
  const records = can(role, "JOB_RECORDS");
  const officeNotes = role === "OWNER" || role === "ADMIN";

  const extra = await db.job.findFirst({
    where: { id: row.id },
    select: { notes: true, client: { select: { email: true, phone: true } } },
  });

  let clockEvents: ManagerJobResponse["clockEvents"] = null;
  let photos: ManagerJobResponse["photos"] = null;
  let checklist: ManagerJobResponse["checklist"] = null;
  let issues: ManagerJobResponse["issues"] = null;

  if (records) {
    const names = new Map<string, string>();
    for (const c of row.cleaners) names.set(c.id, c.name);
    if (row.employee) names.set(row.employee.id, row.employee.name);
    const strangers = [
      ...new Set([...row.workSessions, ...row.breaks].map((s) => s.cleanerId).filter((id) => !names.has(id))),
    ];
    if (strangers.length) {
      const users = await db.user.findMany({ where: { id: { in: strangers } }, select: { id: true, name: true } });
      for (const u of users) names.set(u.id, u.name);
    }
    const pending = await db.timeLogChangeRequest.findMany({
      where: { jobId: row.id, source: "OFFLINE_CLOCK", status: "PENDING" },
      select: { sessionId: true, breakId: true, eventKind: true },
    });
    const pendingFor = (kind: string, sessionId: string | null, breakId: string | null) =>
      pending.some(
        (p) => p.eventKind === kind && ((sessionId && p.sessionId === sessionId) || (breakId && p.breakId === breakId)),
      );
    const events: NonNullable<ManagerJobResponse["clockEvents"]> = [];
    const who = (id: string) => names.get(id) ?? "Unknown";
    for (const s of row.workSessions) {
      events.push({ kind: "CLOCK_IN", cleanerId: s.cleanerId, cleanerName: who(s.cleanerId), at: s.startedAt.toISOString(), pendingReview: pendingFor("CLOCK_IN", s.id, null) });
      if (s.endedAt)
        events.push({ kind: "CLOCK_OUT", cleanerId: s.cleanerId, cleanerName: who(s.cleanerId), at: s.endedAt.toISOString(), pendingReview: pendingFor("CLOCK_OUT", s.id, null) });
    }
    for (const b of row.breaks) {
      events.push({ kind: "BREAK_START", cleanerId: b.cleanerId, cleanerName: who(b.cleanerId), at: b.startedAt.toISOString(), pendingReview: pendingFor("BREAK_START", null, b.id) });
      if (b.endedAt)
        events.push({ kind: "BREAK_END", cleanerId: b.cleanerId, cleanerName: who(b.cleanerId), at: b.endedAt.toISOString(), pendingReview: pendingFor("BREAK_END", null, b.id) });
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
    clockEvents = events;

    const [photoRows, items, issueRows] = await Promise.all([
      db.jobPhoto.findMany({
        // Only stored URLs go out (API_V1.md §4): the company's Cloudinary.
        where: { jobId: row.id, url: { startsWith: "https://res.cloudinary.com/" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: { id: true, kind: true, url: true, createdAt: true, employee: { select: { name: true } } },
      }),
      db.jobChecklistItem.findMany({ where: { checklist: { jobId: row.id } }, select: { status: true } }),
      db.jobIssue.findMany({
        where: { jobId: row.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        select: { id: true, category: true, urgency: true, status: true, description: true, reportedByName: true, createdAt: true },
      }),
    ]);
    photos = photoRows.map((p) => ({
      id: p.id,
      kind: p.kind,
      url: p.url,
      takenBy: p.employee?.name ?? "The client",
      takenAt: p.createdAt.toISOString(),
    }));
    checklist = { done: items.filter((i) => i.status === "COMPLETED").length, total: items.length };
    issues = issueRows.map((i) => ({
      id: i.id,
      category: i.category as never,
      urgency: i.urgency as never,
      status: i.status as never,
      note: i.description,
      reportedBy: i.reportedByName,
      reportedAt: i.createdAt.toISOString(),
    }));
  }

  const open = !row.deletedAt;
  return {
    ...base,
    client: {
      name: base.client.name,
      phone: contact ? (extra?.client?.phone ?? null) : null,
      email: contact ? (extra?.client?.email ?? null) : null,
    },
    notes: officeNotes ? (extra?.notes ?? null) : sanitizeCleanerNotes(extra?.notes ?? null),
    clockEvents,
    photos,
    checklist,
    issues,
    can: {
      setCrew: open && can(role, "CREW_SET"),
      addCleaner: open && can(role, "CREW_ADD"),
    },
  };
}
