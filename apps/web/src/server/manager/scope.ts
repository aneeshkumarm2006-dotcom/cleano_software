// Whose work a manager may see (packages/api/src/v1/manager-access.ts, rule 3).
//
// Every manager service that reads or changes a job resolves the caller's
// view here, from the role re-read by v1Route and the Field Lead group
// resolved server-side (field-lead-group.server.ts). The request never names
// a scope or a group, so there is nothing in it to widen.
//
//   COMPANY  OWNER and ADMIN on every date; OPS_MANAGER on today;
//   OWN      OPS_MANAGER on any other date: jobs they lead or are on;
//   GROUP    FIELD_LEAD on every date: fieldLeadScopedJobsWhere(group),
//            which fails closed on an empty group.
//
// "Today" is the company's day (storeDateKey runs in the org's zone inside
// v1Route's runAsOrg), never the phone's.
import "server-only";

import { can, dayScopeFor, type DayScope } from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { fieldLeadScopedJobsWhere } from "@/lib/cleaner-jobs";
import { fieldLeadGroupIds } from "@/lib/field-lead-group.server";
import { db } from "@/lib/org-db";
import { storeDateKey } from "@/lib/timezone";

import type { Actor } from "../actor";

export interface ManagerView {
  actor: Actor;
  /** The Field Lead's group, lead first; null for every other role. */
  groupIds: string[] | null;
  /** The company's date key for `now`. */
  todayKey: string;
}

export async function managerView(actor: Actor, now: Date): Promise<ManagerView> {
  const groupIds = actor.role === "FIELD_LEAD" ? await fieldLeadGroupIds(actor.userId) : null;
  return { actor, groupIds, todayKey: storeDateKey(now) };
}

/** The scope for one company day, or null for a role that sees none. */
export function scopeForDay(view: ManagerView, dateKey: string): DayScope | null {
  return dayScopeFor(view.actor.role, dateKey === view.todayKey);
}

/** The where-fragment for a scope. COMPANY narrows nothing beyond the company itself. */
export function scopeWhere(view: ManagerView, scope: DayScope): Prisma.JobWhereInput {
  switch (scope) {
    case "COMPANY":
      return {};
    case "GROUP":
      return fieldLeadScopedJobsWhere(view.groupIds ?? []);
    case "OWN":
      return {
        OR: [{ employeeId: view.actor.userId }, { cleaners: { some: { id: view.actor.userId } } }],
      };
  }
}

/** Is a job on the company's today: by its date or its start, as getJobsForDay reads a day. */
export function isOnToday(view: ManagerView, job: { jobDate: Date | null; startTime: Date }): boolean {
  return (
    storeDateKey(job.startTime) === view.todayKey || (!!job.jobDate && storeDateKey(job.jobDate) === view.todayKey)
  );
}

/**
 * The job, if it is in this caller's view (rule 3); null otherwise, which the
 * caller answers as 404. The company is in every query (the org-scoped client),
 * and the scope is decided from the job's own day, read here, never from the
 * request.
 */
export async function jobInView(view: ManagerView, jobId: string): Promise<{ id: string; deletedAt: Date | null } | null> {
  const base = await db.job.findFirst({
    where: { id: jobId },
    select: { id: true, jobDate: true, startTime: true, deletedAt: true },
  });
  if (!base) return null;
  const scope = dayScopeFor(view.actor.role, isOnToday(view, base));
  if (!scope) return null;
  if (scope === "COMPANY") return { id: base.id, deletedAt: base.deletedAt };
  const hit = await db.job.findFirst({
    where: { AND: [{ id: base.id }, scopeWhere(view, scope)] },
    select: { id: true, deletedAt: true },
  });
  return hit;
}

/**
 * Which of these job ids are in the caller's view, in two queries however many
 * there are (for the alerts feed and anything else that names jobs in bulk).
 */
export async function jobsInView(view: ManagerView, jobIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const rows = await db.job.findMany({
    where: { id: { in: ids } },
    select: { id: true, jobDate: true, startTime: true },
  });
  const out = new Set<string>();
  const needCheck: { id: string; scope: DayScope }[] = [];
  for (const r of rows) {
    const scope = dayScopeFor(view.actor.role, isOnToday(view, r));
    if (!scope) continue;
    if (scope === "COMPANY") out.add(r.id);
    else needCheck.push({ id: r.id, scope });
  }
  for (const scope of ["OWN", "GROUP"] as const) {
    const these = needCheck.filter((n) => n.scope === scope).map((n) => n.id);
    if (these.length === 0) continue;
    const hits = await db.job.findMany({
      where: { AND: [{ id: { in: these } }, scopeWhere(view, scope)] },
      select: { id: true },
    });
    for (const h of hits) out.add(h.id);
  }
  return out;
}

/** "Maria" from "Maria Lopez"; the first name is all a lead sees of a client. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** The client's name as this role may see it: full for JOB_CONTACT, first name otherwise. */
export function clientNameFor(role: string, name: string | null | undefined): string {
  return can(role, "JOB_CONTACT") ? (name ?? "").trim() : firstName(name);
}
