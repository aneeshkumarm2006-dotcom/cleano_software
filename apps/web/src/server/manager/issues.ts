// Problems cleaners reported, as the office works them
// (packages/api/src/v1/manager-inbox.ts: GET /manager/issues, GET …/:id,
// POST …/:id/status).
//
// ISSUES (OWNER, ADMIN; jobIssues.ts requireOwnerAdmin). One implementation,
// two front doors: the web's setJobIssueStatus is a thin adapter over
// setIssueStatus below.
import "server-only";

import type { IssuesResponse, ManagedIssue } from "@bookmops/api/v1";
import { can } from "@bookmops/api/v1";
import {
  isOpenIssueStatus,
  jobIssueCategoryLabel,
  JOB_ISSUE_STATUSES,
  JOB_ISSUE_STATUS_LABEL,
  MAX_ISSUE_DESCRIPTION,
  parseJobIssueStatus,
  parseJobIssueUrgency,
} from "@bookmops/core/jobs";
import type { Prisma } from "@prisma/client";

import { currentOrgSlug } from "@/lib/asset-folder";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { parseCompanyFileUrl } from "../storage/company-file-url";
import { failure, notFound, ok, type Result } from "../result";
import { afterKeyset, badCursor, decodeKeyset, encodeKeyset } from "./cursor";

const OPEN_STATUSES = JOB_ISSUE_STATUSES.filter(isOpenIssueStatus);
const PAGE_SIZE = 30;
const NOT_FOUND = "That issue no longer exists.";
const FORBIDDEN = "Your role can't do this.";

const ROW_SELECT = {
  id: true,
  jobId: true,
  reportedByName: true,
  category: true,
  urgency: true,
  status: true,
  description: true,
  photoUrl: true,
  acknowledgedAt: true,
  resolvedAt: true,
  resolvedById: true,
  resolutionNote: true,
  createdAt: true,
  job: { select: { jobNumber: true, clientName: true, startTime: true } },
} as const satisfies Prisma.JobIssueSelect;
type Row = Prisma.JobIssueGetPayload<{ select: typeof ROW_SELECT }>;

async function toIssues(rows: Row[]): Promise<ManagedIssue[]> {
  const resolverIds = [...new Set(rows.map((r) => r.resolvedById).filter((v): v is string => !!v))];
  const resolvers = resolverIds.length
    ? await db.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(resolvers.map((u) => [u.id, u.name]));
  const slug = await currentOrgSlug();
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  return rows.map(
    (r) =>
      ({
        id: r.id,
        job: {
          id: r.jobId,
          jobNumber: r.job.jobNumber,
          clientName: r.job.clientName,
          startsAt: r.job.startTime.toISOString(),
        },
        reportedBy: r.reportedByName,
        category: r.category,
        urgency: parseJobIssueUrgency(r.urgency),
        status: parseJobIssueStatus(r.status),
        note: r.description,
        // Only a file on the company's own storage goes out.
        photoUrl: r.photoUrl && parseCompanyFileUrl(r.photoUrl, { cloudName, orgSlug: slug }) ? r.photoUrl : null,
        reportedAt: r.createdAt.toISOString(),
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolvedBy: r.resolvedById ? (nameOf.get(r.resolvedById) ?? null) : null,
        resolutionNote: r.resolutionNote,
      }) as ManagedIssue,
  );
}

/**
 * GET /manager/issues: open (OPEN, ACKNOWLEDGED) URGENT first, then newest;
 * resolved newest first. The open list is two keyset runs, urgent then the
 * rest; the cursor's rank says which run it is in.
 */
export async function listIssuesFor(
  actor: Actor,
  status: "open" | "resolved",
  cursorRaw: string | undefined,
): Promise<Result<IssuesResponse>> {
  if (!can(actor.role, "ISSUES")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const openCount = await db.jobIssue.count({ where: { status: { in: OPEN_STATUSES } } });

  const run = async (where: Prisma.JobIssueWhereInput, after: typeof cursor, take: number) =>
    db.jobIssue.findMany({
      where: { AND: [where, afterKeyset("createdAt", "desc", after)] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: ROW_SELECT,
    });

  if (status === "resolved") {
    const rows = await run({ status: "RESOLVED" }, cursor, PAGE_SIZE + 1);
    const more = rows.length > PAGE_SIZE;
    const kept = rows.slice(0, PAGE_SIZE);
    const last = kept[kept.length - 1];
    return ok({
      items: await toIssues(kept),
      nextCursor: more && last ? encodeKeyset({ at: last.createdAt, id: last.id }) : null,
      openCount,
    });
  }

  // Open: URGENT first, then everything else, each newest first.
  const rank = cursor?.r ?? "URGENT";
  if (rank !== "URGENT" && rank !== "REST") return badCursor();
  const kept: (Row & { rank: string })[] = [];
  let more = false;
  if (rank === "URGENT") {
    const urgent = await run({ status: { in: OPEN_STATUSES }, urgency: "URGENT" }, cursor, PAGE_SIZE + 1);
    kept.push(...urgent.slice(0, PAGE_SIZE).map((r) => ({ ...r, rank: "URGENT" })));
    more = urgent.length > PAGE_SIZE;
  }
  if (!more && kept.length < PAGE_SIZE) {
    const rest = await run(
      { status: { in: OPEN_STATUSES }, urgency: { not: "URGENT" } },
      rank === "REST" ? cursor : undefined,
      PAGE_SIZE - kept.length + 1,
    );
    const room = PAGE_SIZE - kept.length;
    kept.push(...rest.slice(0, room).map((r) => ({ ...r, rank: "REST" })));
    more = rest.length > room;
  }
  const last = kept[kept.length - 1];
  return ok({
    items: await toIssues(kept),
    nextCursor: more && last ? encodeKeyset({ at: last.createdAt, id: last.id, r: last.rank }) : null,
    openCount,
  });
}

/** GET /manager/issues/:id */
export async function issueFor(actor: Actor, id: string): Promise<Result<ManagedIssue>> {
  if (!can(actor.role, "ISSUES")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const row = await db.jobIssue.findFirst({ where: { id }, select: ROW_SELECT });
  if (!row) return notFound(NOT_FOUND);
  const [issue] = await toIssues([row]);
  return ok(issue);
}

/**
 * Move an issue along its life cycle (the web's setJobIssueStatus, moved
 * here). ACKNOWLEDGED keeps the first acknowledgement; RESOLVED stamps who
 * and when, with the note; OPEN reopens and clears the resolution. Writes the
 * JobLog line with the actor.
 */
export async function setIssueStatus(
  actor: Actor,
  id: string,
  status: string,
  resolutionNote: string | undefined,
  now: Date,
  via: "web" | "app",
): Promise<Result<{ jobId: string; status: string }>> {
  if (!can(actor.role, "ISSUES")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const next = parseJobIssueStatus(status);
  const note =
    typeof resolutionNote === "string" && resolutionNote.trim().length > 0
      ? resolutionNote.trim().slice(0, MAX_ISSUE_DESCRIPTION)
      : null;

  const issue = await db.jobIssue.findFirst({
    where: { id },
    select: { id: true, jobId: true, category: true, acknowledgedAt: true },
  });
  if (!issue) return notFound(NOT_FOUND);

  await db.jobIssue.updateMany({
    where: { id: issue.id },
    data: {
      status: next,
      // Resolving implies somebody read it, so a straight OPEN → RESOLVED
      // still leaves an acknowledged-at behind.
      acknowledgedAt: next === "OPEN" ? null : (issue.acknowledgedAt ?? now),
      resolvedAt: next === "RESOLVED" ? now : null,
      resolvedById: next === "RESOLVED" ? actor.userId : null,
      resolutionNote: next === "RESOLVED" ? note : null,
    },
  });

  const fromApp = via === "app" ? ` by ${actor.name ?? "an admin"} from the app` : "";
  await db.jobLog
    .create({
      data: {
        jobId: issue.jobId,
        userId: actor.userId,
        action: "NOTE_ADDED",
        field: "issue",
        newValue: next,
        description:
          next === "RESOLVED"
            ? `Issue resolved${fromApp} (${jobIssueCategoryLabel(issue.category)})${note ? `: ${note}` : "."}`
            : `Issue marked ${JOB_ISSUE_STATUS_LABEL[next].toLowerCase()}${fromApp} (${jobIssueCategoryLabel(issue.category)}).`,
      },
    })
    .catch((e) => console.error("setIssueStatus: log failed", e));

  return ok({ jobId: issue.jobId, status: next });
}

/** The phone's status change: a resolution needs a note, and the answer is the issue as it stands. */
export async function setIssueStatusFor(
  actor: Actor,
  id: string,
  body: { status: string; resolutionNote?: string },
  now: Date,
): Promise<Result<ManagedIssue>> {
  if (body.status === "RESOLVED" && !body.resolutionNote?.trim()) {
    return failure(400, "NOTE_REQUIRED", "Add a note so the cleaner knows what was done.");
  }
  const res = await setIssueStatus(actor, id, body.status, body.resolutionNote, now, "app");
  if (!res.ok) return res;
  return issueFor(actor, id);
}
