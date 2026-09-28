// Who could work a job, and changing who does (packages/api/src/v1/manager-team.ts:
// GET …/candidates, PUT …/crew, POST …/cleaners).
//
// The rules are the web's assignCleaners (a full crew change, OWNER and ADMIN)
// and bulkAssignCleaner (add one cleaner, OWNER, ADMIN and OPS_MANAGER), built
// from the same helpers: ASSIGNABLE_CREW_WHERE, validateTraineePairing,
// resolveJobLead, syncJobAssignments, the availability evaluation and
// categoryMismatchWarning, and the same emails, invites and push alerts.
//
// What the phone adds, because two managers can hold the same screen:
//   - the job row is locked (SELECT … FOR UPDATE, company in the WHERE) before
//     anything is read that the change depends on, so two changes to one job
//     run one after the other;
//   - under that lock the crew on record must be the crew the caller saw
//     (`expectedCrewIds`, PUT only), else 409 CREW_CHANGED;
//   - the warnings for the people being added are hashed with crewWarningsHash
//     and must be the ones the office was shown (`acknowledgedWarningsHash`),
//     else 409 WARNINGS_CHANGED. Every check happens before the first write,
//     so a refusal leaves nothing behind.
// Emails, invites and push alerts are effects: after the commit, never on a
// replay (manager-access.ts rule 8).
import "server-only";

import { can, crewWarningsHash, type CandidatesResponse, type CrewChangeResponse } from "@bookmops/api/v1";
import { categoryMismatchWarning } from "@bookmops/core/services";

import { availabilityWarning, windowFromInstants, type AvailabilityEvaluation } from "@/lib/availability";
import { requireOrgId } from "@/lib/org";
import { sendAdminBookingModified, sendCustomerBookingConfirmed, sendCustomerBookingModified } from "@/lib/email";
import { createAssignmentInvites } from "@/lib/invites";
import {
  ASSIGNABLE_CREW_WHERE,
  evaluateEmployeesAvailability,
  resolveJobLead,
  syncJobAssignments,
  validateTraineePairing,
} from "@/lib/job-assignments";
import { isNotificationEnabled } from "@/lib/notifications";
import { db } from "@/lib/org-db";
import { fmtDate, fmtTime } from "@/lib/time";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { jobPush } from "../push/notify";
import { failure, notFound, ok, type Result } from "../result";
import { jobInView, managerView } from "./scope";
import { managerJobById } from "./team";

/** Crew changes email the client and invite cleaners (manager-access.ts rule 7). */
export const CREW_CHANGE_LIMIT = { name: "manager-crew", max: 60, windowMs: 60 * 60_000 };

const MAX_CANDIDATES = 500;
const JOB_CLOSED_MESSAGE = "This booking is no longer active.";
const TRAINEE_NEEDS_CREW_MESSAGE =
  "Trainees must be paired with a Field Lead — assign them from a job's Team card, not bulk assign.";
const CREW_CHANGED_MESSAGE = "Someone else changed this crew. Reload to see who is on it now.";
const WARNINGS_CHANGED_MESSAGE = "The warnings for this crew have changed. Reload and check them again.";
const NOT_ASSIGNABLE_MESSAGE =
  "Someone in that list can't be assigned — they're switched off, archived, or not a cleaner here. Refresh and pick again.";

interface Warning {
  cleanerId: string;
  code: string;
  message: string;
}

interface Person {
  id: string;
  name: string;
  allowedServiceCategories: string[];
}

function warningsOf(p: Person, ev: AvailabilityEvaluation | undefined, jobType: string | null): Warning[] {
  const out: Warning[] = [];
  if (ev) {
    const line = availabilityWarning(p.name, ev);
    if (line) {
      const code = ev.blockedDate ? "DAY_OFF" : ev.result === "OUTSIDE_HOURS" ? "OUTSIDE_HOURS" : "UNAVAILABLE";
      out.push({ cleanerId: p.id, code, message: line });
    }
  }
  const category = categoryMismatchWarning(p.name, jobType, p.allowedServiceCategories);
  if (category) out.push({ cleanerId: p.id, code: "CATEGORY_NOT_APPROVED", message: category });
  return out;
}

/** The web's warnings for these people on this job, by person, in one pass. */
async function warningsFor(
  people: Person[],
  job: { startTime: Date; endTime: Date | null; jobType: string | null },
): Promise<{ evaluations: Map<string, AvailabilityEvaluation>; byPerson: Map<string, Warning[]> }> {
  const evaluations = await evaluateEmployeesAvailability(
    people.map((p) => p.id),
    windowFromInstants(job.startTime, job.endTime),
  );
  const byPerson = new Map<string, Warning[]>();
  for (const p of people) byPerson.set(p.id, warningsOf(p, evaluations.get(p.id), job.jobType));
  return { evaluations, byPerson };
}

const hashOf = (warnings: Warning[]) => crewWarningsHash(warnings.map((w) => ({ cleanerId: w.cleanerId, code: w.code })));

// ── Candidates ──────────────────────────────────────────────────────────────

export async function candidatesFor(actor: Actor, jobId: string, now: Date): Promise<Result<CandidatesResponse>> {
  if (!can(actor.role, "CREW_SET") && !can(actor.role, "CREW_ADD")) {
    return failure(403, "FORBIDDEN", "Your role can't do this.");
  }
  const view = await managerView(actor, now);
  if (!(await jobInView(view, jobId))) return notFound("This job isn't available.");

  const job = await db.job.findFirst({
    where: { id: jobId },
    select: { id: true, startTime: true, endTime: true, jobType: true, employeeId: true, cleaners: { select: { id: true } } },
  });
  if (!job) return notFound("This job isn't available.");
  const onJob = new Set([...job.cleaners.map((c) => c.id), ...(job.employeeId ? [job.employeeId] : [])]);

  const people = await db.user.findMany({
    where: ASSIGNABLE_CREW_WHERE,
    select: { id: true, name: true, cleanerTier: true, allowedServiceCategories: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: MAX_CANDIDATES,
  });
  const { evaluations, byPerson } = await warningsFor(people, job);

  const rank = (c: { onJob: boolean; availability: string }) =>
    c.onJob ? 0 : c.availability === "AVAILABLE" ? 1 : c.availability === "NO_DATA" ? 2 : 3;
  const candidates = people.map((p) => {
    const ev = evaluations.get(p.id);
    return {
      id: p.id,
      name: p.name,
      tier: p.cleanerTier,
      onJob: onJob.has(p.id),
      availability: ev?.result ?? "NO_DATA",
      dayOff: !!ev?.blockedDate,
      warnings: (byPerson.get(p.id) ?? []).map((w) => ({ code: w.code, message: w.message })),
    };
  });
  candidates.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return ok({ jobId: job.id, candidates } as CandidatesResponse);
}

// ── Changes ─────────────────────────────────────────────────────────────────

type Refusal = { kind: "refused"; status: 404 | 409; code: string; message: string };

async function lockJob(
  tx: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> },
  jobId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Job" WHERE id = ${jobId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  return rows.length === 1;
}

const sameSet = (a: Iterable<string>, b: Iterable<string>) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

export interface SetCrewInput {
  cleanerIds: string[];
  expectedCrewIds: string[];
  acknowledgedWarningsHash: string;
}

/** PUT /manager/jobs/:id/crew — assign, unassign and reassign in one call. */
export async function setCrewFor(
  actor: Actor,
  jobId: string,
  input: SetCrewInput,
  now: Date,
): Promise<Result<CrewChangeResponse>> {
  if (!can(actor.role, "CREW_SET")) return failure(403, "FORBIDDEN", "Your role can't do this.");
  const view = await managerView(actor, now);
  if (!(await jobInView(view, jobId))) return notFound("This job isn't available.");

  const ids = [...new Set(input.cleanerIds)];
  const job = await db.job.findFirst({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      clientName: true,
      startTime: true,
      endTime: true,
      location: true,
      jobType: true,
      notifyClient: true,
      notifyProvider: true,
      client: { select: { email: true } },
    },
  });
  if (!job) return notFound("This job isn't available.");

  // Every id a person of this company who can be on a crew (the scoped client
  // can't see another company's). Whether they may be ADDED — switched on,
  // not archived — is decided below, for the people actually being added:
  // someone already on the job who has since been switched off stays until
  // an office member takes them off, as on the web.
  const people = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids }, role: { in: ["EMPLOYEE", "FIELD_LEAD"] } },
        select: { id: true, name: true, isActive: true, deletedAt: true, allowedServiceCategories: true },
      })
    : [];
  if (people.length !== ids.length) return failure(400, "VALIDATION_FAILED", NOT_ASSIGNABLE_MESSAGE);
  const byId = new Map(people.map((p) => [p.id, p]));

  const pairing = await validateTraineePairing(ids);
  if (pairing) return failure(409, "TRAINEE_UNPAIRED", pairing);

  const { byPerson } = await warningsFor(people, job);
  const organizationId = await requireOrgId();
  const actorName = actor.name ?? "An admin";

  const outcome = await db.$transaction(async (tx) => {
    if (!(await lockJob(tx, jobId, organizationId))) {
      return { kind: "refused", status: 404, code: "NOT_FOUND", message: "This job isn't available." } satisfies Refusal;
    }
    const current = await tx.job.findFirst({
      where: { id: jobId },
      select: { employeeId: true, deletedAt: true, cleaners: { select: { id: true } } },
    });
    if (!current) return { kind: "refused", status: 404, code: "NOT_FOUND", message: "This job isn't available." } satisfies Refusal;
    if (current.deletedAt) return { kind: "refused", status: 409, code: "JOB_CLOSED", message: JOB_CLOSED_MESSAGE } satisfies Refusal;

    const roster = current.cleaners.map((c) => c.id);
    const crewNow = new Set([...roster, ...(current.employeeId ? [current.employeeId] : [])]);
    if (!sameSet(crewNow, input.expectedCrewIds)) {
      return { kind: "refused", status: 409, code: "CREW_CHANGED", message: CREW_CHANGED_MESSAGE } satisfies Refusal;
    }

    const added = ids.filter((id) => !crewNow.has(id));
    if (added.some((id) => !byId.get(id)?.isActive || byId.get(id)?.deletedAt)) {
      return { kind: "refused", status: 409, code: "CREW_CHANGED", message: NOT_ASSIGNABLE_MESSAGE } satisfies Refusal;
    }
    const warnings = added.flatMap((id) => byPerson.get(id) ?? []);
    if (hashOf(warnings) !== input.acknowledgedWarningsHash) {
      return { kind: "refused", status: 409, code: "WARNINGS_CHANGED", message: WARNINGS_CHANGED_MESSAGE } satisfies Refusal;
    }

    // Every check is behind us; the writes, as assignCleaners makes them.
    await tx.job.update({
      where: { id: jobId },
      data: {
        employeeId: resolveJobLead(current.employeeId, ids),
        cleaners: { set: ids.map((id) => ({ id })) },
      },
    });
    const before = [...crewNow].map((id) => byId.get(id)?.name ?? id);
    await tx.jobLog.create({
      data: {
        jobId,
        userId: actor.userId,
        action: "UPDATED",
        field: "cleaners",
        oldValue: before.join(", ") || "—",
        newValue: ids.map((id) => byId.get(id)?.name ?? id).join(", ") || "—",
        description: `Cleaners updated by ${actorName} from the app — ${ids.length} assigned`,
      },
    });
    const sync = await syncJobAssignments(jobId, ids, tx);
    if (!sync.ok) throw new Error("crew change: assignment rows not written");
    for (const [label, list] of [
      ["Availability conflict overridden", warnings.filter((w) => w.code !== "CATEGORY_NOT_APPROVED")],
      ["Service category mismatch overridden", warnings.filter((w) => w.code === "CATEGORY_NOT_APPROVED")],
    ] as const) {
      if (list.length === 0) continue;
      await tx.jobLog.create({
        data: {
          jobId,
          userId: actor.userId,
          action: "UPDATED",
          field: "cleaners",
          description: `${label} from the app by ${actorName} — ${list.map((w) => w.message).join("; ")}`,
        },
      });
    }
    return {
      kind: "done" as const,
      justGotFirstCleaner: roster.length === 0 && ids.length > 0,
      // Invites go to people new to the roster, as the web's newlyAdded.
      invited: ids.filter((id) => !roster.includes(id)),
      removed: [...crewNow].filter((id) => !ids.includes(id)),
      overridden: warnings.map((w) => w.message),
    };
  });

  if (outcome.kind === "refused") return failure(outcome.status, outcome.code, outcome.message);

  const effects: Effect[] = [];
  const lifecycle = {
    jobId,
    jobNumber: job.jobNumber,
    clientName: job.clientName,
    startTime: job.startTime.toISOString(),
    address: job.location ?? "",
    serviceType: job.jobType,
  };
  if (outcome.justGotFirstCleaner && job.notifyClient && job.client?.email) {
    const to = job.client.email;
    const cleanerNames = ids.map((id) => byId.get(id)?.name ?? "").filter(Boolean);
    effects.push(
      effect("crew: customer confirmed email", () => sendCustomerBookingConfirmed({ ...lifecycle, to, cleanerNames })),
    );
  } else {
    effects.push(effect("crew: admin modified email", () => sendAdminBookingModified({ ...lifecycle, changedBy: actorName })));
    if (job.notifyClient && job.client?.email) {
      const to = job.client.email;
      effects.push(effect("crew: customer modified email", () => sendCustomerBookingModified({ ...lifecycle, to })));
    }
  }
  effects.push(
    jobPush("assigned", jobId, outcome.invited, actor.userId),
    jobPush("unassigned", jobId, outcome.removed, actor.userId),
  );
  if (outcome.invited.length > 0) {
    const cleanerIds = outcome.invited;
    effects.push(effect("crew: invites", () => createAssignmentInvites({ jobId, cleanerIds })));
    if (job.notifyProvider) {
      effects.push(
        effect("crew: provider push alerts", async () => {
          if (!(await isNotificationEnabled("PROVIDER", "prov.booking.new", "APP_PUSH"))) return;
          for (const cleanerId of cleanerIds) {
            await db.alert
              .create({
                data: {
                  type: "GENERAL",
                  severity: "INFO",
                  title: `New booking — ${job.clientName}`,
                  message: `Job #${job.jobNumber} on ${fmtDate(job.startTime)} at ${fmtTime(job.startTime)} has been assigned to you.`,
                  recipientUserId: cleanerId,
                  relatedId: jobId,
                  relatedType: "Job",
                },
              })
              .catch(() => {});
          }
        }),
      );
    }
  }

  const updated = await managerJobById(view, jobId, now);
  if (!updated) return notFound("This job isn't available.");
  return ok({ job: updated, overridden: outcome.overridden }, effects);
}

export interface AddCleanerInput {
  cleanerId: string;
  acknowledgedWarningsHash: string;
}

/** POST /manager/jobs/:id/cleaners — add one cleaner, as the web's bulk assign does for one job. */
export async function addCleanerFor(
  actor: Actor,
  jobId: string,
  input: AddCleanerInput,
  now: Date,
): Promise<Result<CrewChangeResponse>> {
  if (!can(actor.role, "CREW_ADD")) return failure(403, "FORBIDDEN", "Your role can't do this.");
  const view = await managerView(actor, now);
  if (!(await jobInView(view, jobId))) return notFound("This job isn't available.");

  const cleaner = await db.user.findFirst({
    where: { id: input.cleanerId, ...ASSIGNABLE_CREW_WHERE },
    select: { id: true, name: true, cleanerTier: true, allowedServiceCategories: true },
  });
  if (!cleaner) return notFound("That cleaner isn't available.");
  if (cleaner.cleanerTier === "TRAINEE") return failure(409, "TRAINEE_NEEDS_CREW", TRAINEE_NEEDS_CREW_MESSAGE);

  const job = await db.job.findFirst({
    where: { id: jobId },
    select: { startTime: true, endTime: true, jobType: true },
  });
  if (!job) return notFound("This job isn't available.");
  const { byPerson } = await warningsFor([cleaner], job);
  const warnings = byPerson.get(cleaner.id) ?? [];
  const organizationId = await requireOrgId();
  const actorName = actor.name ?? "An admin";

  const outcome = await db.$transaction(async (tx) => {
    if (!(await lockJob(tx, jobId, organizationId))) {
      return { kind: "refused", status: 404, code: "NOT_FOUND", message: "This job isn't available." } satisfies Refusal;
    }
    const current = await tx.job.findFirst({
      where: { id: jobId },
      select: { employeeId: true, deletedAt: true, cleaners: { select: { id: true } } },
    });
    if (!current) return { kind: "refused", status: 404, code: "NOT_FOUND", message: "This job isn't available." } satisfies Refusal;
    if (current.deletedAt) return { kind: "refused", status: 409, code: "JOB_CLOSED", message: JOB_CLOSED_MESSAGE } satisfies Refusal;

    const onIt = current.employeeId === cleaner.id || current.cleaners.some((c) => c.id === cleaner.id);
    // Adding someone already on it changes nothing, so there is nothing to warn about.
    if (onIt) return { kind: "unchanged" as const, overridden: [] as string[] };
    if (hashOf(warnings) !== input.acknowledgedWarningsHash) {
      return { kind: "refused", status: 409, code: "WARNINGS_CHANGED", message: WARNINGS_CHANGED_MESSAGE } satisfies Refusal;
    }

    await tx.job.update({
      where: { id: jobId },
      data: {
        cleaners: { connect: { id: cleaner.id } },
        ...(current.employeeId ? {} : { employeeId: cleaner.id }),
      },
    });
    const existing = await tx.jobAssignment.findFirst({
      where: { jobId, cleanerId: cleaner.id },
      select: { id: true },
    });
    if (!existing) await tx.jobAssignment.create({ data: { jobId, cleanerId: cleaner.id, status: "ASSIGNED" } });
    const notes = warnings.map((w) =>
      w.code === "CATEGORY_NOT_APPROVED"
        ? `service category mismatch overridden (${w.message})`
        : `availability conflict overridden (${w.message})`,
    );
    await tx.jobLog.create({
      data: {
        jobId,
        userId: actor.userId,
        action: "UPDATED",
        field: "cleaners",
        newValue: cleaner.name,
        description: `${cleaner.name} assigned from the app by ${actorName}${notes.length ? ` — ${notes.join("; ")}` : ""}`,
      },
    });
    return { kind: "done" as const, overridden: warnings.map((w) => w.message) };
  });

  if (outcome.kind === "refused") return failure(outcome.status, outcome.code, outcome.message);
  const updated = await managerJobById(view, jobId, now);
  if (!updated) return notFound("This job isn't available.");
  // No emails: the web's bulk path sends none, and this is that path. The
  // person added is told on their phone, as for any other crew change.
  return ok(
    { job: updated, overridden: outcome.overridden },
    outcome.kind === "done" ? [jobPush("assigned", jobId, [cleaner.id], actor.userId)] : [],
  );
}
