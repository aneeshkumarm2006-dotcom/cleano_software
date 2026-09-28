// The office's notification feed and late arrivals
// (packages/api/src/v1/manager-inbox.ts: GET /manager/alerts,
// POST /manager/alerts/read, GET /manager/late-arrivals).
//
// The feed is the web's (lib/admin-notifications.ts): one Notification row
// per event, each person's read and archived state in NotificationRead. The
// phone reads it with the same rules, and narrows it for a FIELD_LEAD:
//   - only FIELD_LEAD_ALERT_KINDS, and only rows whose job (parsed from the
//     row's `/admin/jobs/:id` href) is in the lead's group. A row with no job,
//     or another group's, is never sent, counted or marked read;
//   - the catalogue's title and body are written for the office and can name
//     the client in full, so a lead gets a title built here from the kind and
//     the job number, and a null body.
// Late arrivals are read from what clockIn already writes on the job
// (lateArrivalAt, lateArrivalRatingPenalty), so nothing new is recorded.
import "server-only";

import {
  type Alert,
  type AlertsResponse,
  FIELD_LEAD_ALERT_KINDS,
  type LateArrival,
  type LateArrivalsResponse,
  type ALERT_KINDS,
  can,
} from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { fieldLeadScopedJobsWhere } from "@/lib/cleaner-jobs";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { jobArea } from "../jobs/area";
import { failure, ok, type Result } from "../result";
import { afterKeyset, badCursor, decodeKeyset, encodeKeyset, pageBy } from "./cursor";
import { jobsInView, managerView, type ManagerView } from "./scope";

type AlertKind = (typeof ALERT_KINDS)[number];

const PAGE_SIZE = 30;
/** How many feed rows one FIELD_LEAD page may look through to fill itself. */
const LEAD_SCAN_LIMIT = 600;
/** How far back a FIELD_LEAD's unread count looks: the newest rows of their kinds. */
const LEAD_UNREAD_WINDOW = 1000;
const FORBIDDEN = "Your role can't do this.";

/** The catalogue key → the kind the app knows. Anything else is OTHER. */
const KIND_BY_KEY: Record<string, AlertKind> = {
  "admin.shift.dropped": "SHIFT_DROPPED",
  "admin.shift.dropped_urgent": "COVER_NEEDED",
  "admin.clock.left_running": "CLOCK_LEFT_RUNNING",
  "admin.clock.clock_in_failed": "CLOCK_FAILED",
  "admin.clock.clock_out_failed": "CLOCK_FAILED",
  "admin.jobs.unassigned_by_deactivation": "JOBS_UNASSIGNED",
  "admin.timelog.change_requested": "TIME_CHANGE_REQUESTED",
  "admin.job.issue_reported": "ISSUE_REPORTED",
  "admin.clock.clocked_in": "CLOCKED_IN",
  "admin.clock.clocked_out": "CLOCKED_OUT",
};

const kindOf = (key: string): AlertKind => KIND_BY_KEY[key] ?? "OTHER";

/** The catalogue keys a FIELD_LEAD's feed may carry. */
const LEAD_KEYS = Object.entries(KIND_BY_KEY)
  .filter(([, kind]) => (FIELD_LEAD_ALERT_KINDS as readonly string[]).includes(kind))
  .map(([key]) => key);

/** The words a lead's title starts with. Built here; never the catalogue's. */
const LEAD_TITLE: Record<(typeof FIELD_LEAD_ALERT_KINDS)[number], string> = {
  SHIFT_DROPPED: "Shift dropped",
  COVER_NEEDED: "Cover needed",
  CLOCK_LEFT_RUNNING: "Clock left running",
  CLOCK_FAILED: "Clock problem",
  CLOCKED_IN: "Clocked in",
  CLOCKED_OUT: "Clocked out",
};

const JOB_HREF = /^\/admin\/jobs\/([A-Za-z0-9_-]{1,64})(?:[/?#]|$)/;

/** The job a feed row is about, from its web href, or null. */
export function jobIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = JOB_HREF.exec(href);
  return m ? m[1] : null;
}

const isLead = (actor: Actor) => actor.role === "FIELD_LEAD";

/** Rows the caller hasn't archived: the web's default feed. */
const notArchivedBy = (userId: string): Prisma.NotificationWhereInput => ({
  reads: { none: { userId, dismissedAt: { not: null } } },
});

const leadRows: Prisma.NotificationWhereInput = {
  notificationKey: { in: LEAD_KEYS },
  href: { startsWith: "/admin/jobs/" },
};

type FeedRow = {
  id: string;
  notificationKey: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: string;
  createdAt: Date;
  reads: { id: string }[];
};

/** Of these feed rows, the ones about a job in the lead's group. */
async function leadVisible(view: ManagerView, rows: { href: string | null }[]): Promise<Set<string>> {
  return jobsInView(
    view,
    rows.map((r) => jobIdFromHref(r.href)).filter((v): v is string => !!v),
  );
}

async function unreadFor(view: ManagerView): Promise<number> {
  const userId = view.actor.userId;
  if (!isLead(view.actor)) {
    // countUnreadAdminNotifications: no read row for this person at all.
    return db.notification.count({ where: { reads: { none: { userId } } } });
  }
  const rows = await db.notification.findMany({
    where: { AND: [leadRows, { reads: { none: { userId } } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LEAD_UNREAD_WINDOW,
    select: { href: true },
  });
  const inView = await leadVisible(view, rows);
  return rows.filter((r) => {
    const id = jobIdFromHref(r.href);
    return !!id && inView.has(id);
  }).length;
}

/** GET /manager/alerts */
export async function alertsFor(actor: Actor, cursorRaw: string | undefined, now: Date): Promise<Result<AlertsResponse>> {
  if (!can(actor.role, "ALERTS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const view = await managerView(actor, now);
  const select = {
    id: true,
    notificationKey: true,
    title: true,
    body: true,
    href: true,
    severity: true,
    createdAt: true,
    reads: { where: { userId: actor.userId }, select: { id: true } },
  } as const;

  let kept: FeedRow[];
  let nextCursor: string | null;
  let inView: Set<string>;
  if (!isLead(actor)) {
    const rows = await db.notification.findMany({
      where: { AND: [notArchivedBy(actor.userId), afterKeyset("createdAt", "desc", cursor)] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      select,
    });
    const page = pageBy(rows, PAGE_SIZE, (r) => ({ at: r.createdAt, id: r.id }));
    kept = page.rows;
    nextCursor = page.nextCursor;
    inView = await jobsInView(view, kept.map((r) => jobIdFromHref(r.href)).filter((v): v is string => !!v));
  } else {
    // Filtered after the read (the job's group can't be joined through an
    // href), so a page is filled from batches, looking through at most
    // LEAD_SCAN_LIMIT rows; the cursor then resumes after the last one looked at.
    kept = [];
    inView = new Set();
    nextCursor = null;
    let after = cursor;
    let scanned = 0;
    for (;;) {
      const batch = await db.notification.findMany({
        where: { AND: [leadRows, notArchivedBy(actor.userId), afterKeyset("createdAt", "desc", after)] },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select,
      });
      if (batch.length === 0) break;
      const visible = await leadVisible(view, batch);
      let full = false;
      for (const r of batch) {
        scanned++;
        after = { at: r.createdAt, id: r.id };
        const id = jobIdFromHref(r.href);
        if (id && visible.has(id)) {
          kept.push(r);
          inView.add(id);
          if (kept.length === PAGE_SIZE) {
            full = true;
            break;
          }
        }
      }
      if (full || scanned >= LEAD_SCAN_LIMIT) {
        nextCursor = after ? encodeKeyset(after) : null;
        break;
      }
      if (batch.length < 100) break;
    }
  }

  // Job numbers for a lead's titles.
  const numbers = new Map<string, number>();
  if (isLead(actor) && kept.length) {
    const jobs = await db.job.findMany({
      where: { id: { in: [...inView] } },
      select: { id: true, jobNumber: true },
    });
    for (const j of jobs) numbers.set(j.id, j.jobNumber);
  }

  const items: Alert[] = kept.map((r) => {
    const kind = kindOf(r.notificationKey);
    const jobId = jobIdFromHref(r.href);
    const shownJob = jobId && inView.has(jobId) ? jobId : null;
    const lead = isLead(actor);
    return {
      id: r.id,
      kind,
      severity: r.severity,
      title: lead
        ? `${LEAD_TITLE[kind as keyof typeof LEAD_TITLE] ?? "Update"}${shownJob && numbers.has(shownJob) ? ` · job #${numbers.get(shownJob)}` : ""}`
        : r.title,
      body: lead ? null : r.body,
      createdAt: r.createdAt.toISOString(),
      read: r.reads.length > 0,
      jobId: shownJob,
    } as Alert;
  });
  return ok({ items, nextCursor, unreadCount: await unreadFor(view) });
}

/**
 * POST /manager/alerts/read — mark these read for the caller only. Ids that
 * aren't this company's, or (for a lead) aren't in their feed, are ignored.
 * Idempotent through the unique (notification, person) read row.
 */
export async function markAlertsReadFor(actor: Actor, ids: string[], now: Date): Promise<Result<{ unreadCount: number }>> {
  if (!can(actor.role, "ALERTS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const view = await managerView(actor, now);
  const unique = [...new Set(ids)].slice(0, 200);
  const rows = await db.notification.findMany({
    where: { AND: [{ id: { in: unique } }, isLead(actor) ? leadRows : {}] },
    select: { id: true, href: true },
  });
  let allowed = rows;
  if (isLead(actor)) {
    const visible = await leadVisible(view, rows);
    allowed = rows.filter((r) => {
      const id = jobIdFromHref(r.href);
      return !!id && visible.has(id);
    });
  }
  if (allowed.length) {
    await db.notificationRead.createMany({
      data: allowed.map((r) => ({ notificationId: r.id, userId: actor.userId })),
      skipDuplicates: true,
    });
  }
  return ok({ unreadCount: await unreadFor(view) });
}

// ── Late arrivals ─────────────────────────────────────────────────────────────

const LATE_WINDOW_MS = 30 * 24 * 3600_000;
/** clockIn's strike threshold (server/clock/clock-in.ts STRIKE_LATE_MIN). */
const STRIKE_LATE_MIN = 45;

/** GET /manager/late-arrivals: the last 30 days, newest first. */
export async function lateArrivalsFor(
  actor: Actor,
  cursorRaw: string | undefined,
  now: Date,
): Promise<Result<LateArrivalsResponse>> {
  if (!can(actor.role, "ALERTS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const view = await managerView(actor, now);
  const scope: Prisma.JobWhereInput = isLead(actor) ? fieldLeadScopedJobsWhere(view.groupIds ?? []) : {};
  const rows = await db.job.findMany({
    where: {
      AND: [
        scope,
        { lateArrivalAt: { gte: new Date(now.getTime() - LATE_WINDOW_MS) }, isFlexible: false },
        afterKeyset("lateArrivalAt", "desc", cursor),
      ],
    },
    orderBy: [{ lateArrivalAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      jobNumber: true,
      startTime: true,
      location: true,
      lateArrivalAt: true,
      lateArrivalRatingPenalty: true,
      employeeId: true,
      clientAddress: { select: { city: true } },
      // The late clock-in is the session opened at the moment clockIn stamped.
      workSessions: { select: { cleanerId: true, startedAt: true }, orderBy: { startedAt: "asc" } },
      assignments: { select: { id: true, cleanerId: true } },
    },
  });
  const page = pageBy(rows, PAGE_SIZE, (r) => ({ at: r.lateArrivalAt!, id: r.id }));

  const who = new Map<string, string | null>();
  for (const j of page.rows) {
    const at = j.lateArrivalAt!.getTime();
    const s = j.workSessions.find((w) => Math.abs(w.startedAt.getTime() - at) < 1_000) ?? j.workSessions[0];
    who.set(j.id, s?.cleanerId ?? j.employeeId);
  }
  const ids = [...new Set([...who.values()].filter((v): v is string => !!v))];
  const people = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const items: LateArrival[] = [];
  for (const j of page.rows) {
    const cleanerId = who.get(j.id);
    if (!cleanerId) continue;
    const minutesLate = Math.max(0, Math.floor((j.lateArrivalAt!.getTime() - j.startTime.getTime()) / 60_000));
    const assignment = j.assignments.find((a) => a.cleanerId === cleanerId);
    items.push({
      id: assignment?.id ?? j.id,
      job: { id: j.id, jobNumber: j.jobNumber, startsAt: j.startTime.toISOString(), area: jobArea(j) },
      cleaner: { id: cleanerId, name: nameOf.get(cleanerId) ?? "A cleaner" },
      clockedInAt: j.lateArrivalAt!.toISOString(),
      minutesLate,
      ratingPenalty: j.lateArrivalRatingPenalty,
      strike: minutesLate >= STRIKE_LATE_MIN,
    });
  }
  return ok({ items, nextCursor: page.nextCursor });
}
