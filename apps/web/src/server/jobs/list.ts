// The cleaner's own jobs: upcoming, past, or the ones starting in a span of
// dates (GET /api/v1/jobs; packages/api/src/v1/jobs.ts and calendar.ts).
//
// Scoped by the same predicates as the web's My Jobs, dashboard and calendar
// (lib/cleaner-jobs.ts): only jobs this cleaner leads or is on, never a
// soft-deleted job, never an unsettled quote, and "upcoming" runs to the end of
// the job's service window exactly as on the web.
//
// The web page's loader is not reused wholesale: it renders filters, a hero
// card, invites and a missing-kit check the phone doesn't ask for. What is
// shared is the part that decides WHICH jobs a cleaner sees.
import "server-only";

import type { JobSummary } from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { pastJobsWhere, upcomingJobsWhere, cleanerAssignedWhere } from "@/lib/cleaner-jobs";
import { db } from "@/lib/org-db";
import { storeCivilDayRange } from "@/lib/timezone";

import type { Actor } from "../actor";
import { failure, ok, type Result } from "../result";
import { SUMMARY_SELECT, summarise } from "./summary";

export const PAGE_SIZE = 20;
export const MAX_CALENDAR_SPAN_DAYS = 62;

export type ListInput =
  | { kind: "scope"; scope: "upcoming" | "past"; cursor?: string }
  | { kind: "range"; from: string; to: string; cursor?: string };

interface Cursor {
  s: string;
  id: string;
}

/**
 * Cursors are opaque to the app and untrusted here: a malformed one is a 400,
 * and a well-formed one only ever narrows the scoped query below.
 */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | undefined): Cursor | null | "invalid" {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!v || typeof v !== "object") return "invalid";
    const { s, id } = v as Record<string, unknown>;
    if (typeof s !== "string" || typeof id !== "string" || id.length > 64) return "invalid";
    if (Number.isNaN(new Date(s).getTime())) return "invalid";
    return { s, id };
  } catch {
    return "invalid";
  }
}

/** Whole days from one YYYY-MM-DD to another, on the calendar itself. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export async function listMyJobs(
  actor: Actor,
  input: ListInput,
  now: Date,
): Promise<Result<{ items: JobSummary[]; nextCursor: string | null }>> {
  const cursor = decodeCursor(input.cursor);
  if (cursor === "invalid") return failure(400, "VALIDATION_FAILED", "That page link isn't valid. Refresh and try again.");

  let where: Prisma.JobWhereInput;
  let direction: "asc" | "desc";

  if (input.kind === "range") {
    const span = daysBetween(input.from, input.to);
    if (span < 0 || span > MAX_CALENDAR_SPAN_DAYS) {
      return failure(400, "VALIDATION_FAILED", "Pick a range of up to two months.");
    }
    // Starts on a date from `from` to `to` inclusive, in the company's zone.
    const start = storeCivilDayRange(input.from).start;
    const end = storeCivilDayRange(input.to).end;
    const base = cleanerAssignedWhere(actor.userId);
    where = {
      ...base,
      AND: [
        ...(base.AND as Prisma.JobWhereInput[]),
        { startTime: { gte: start, lt: end } },
        { status: { not: "CANCELLED" } },
      ],
    };
    direction = "asc";
  } else if (input.scope === "upcoming") {
    where = upcomingJobsWhere(actor.userId, now);
    direction = "asc";
  } else {
    const past = pastJobsWhere(actor.userId, now);
    where = { ...past, AND: [...(past.AND as Prisma.JobWhereInput[]), { status: { not: "CANCELLED" } }] };
    direction = "desc";
  }

  if (cursor) {
    const at = new Date(cursor.s);
    const cmp = direction === "asc" ? "gt" : "lt";
    where = {
      ...where,
      AND: [
        ...((where.AND as Prisma.JobWhereInput[] | undefined) ?? []),
        { OR: [{ startTime: { [cmp]: at } }, { startTime: at, id: { [cmp]: cursor.id } }] },
      ],
    };
  }

  const rows = await db.job.findMany({
    where,
    orderBy: [{ startTime: direction }, { id: direction }],
    take: PAGE_SIZE + 1,
    select: SUMMARY_SELECT,
  });
  const more = rows.length > PAGE_SIZE;
  const page = more ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  return ok({
    items: await summarise(page, actor.userId),
    nextCursor: more && last ? encodeCursor({ s: last.startTime.toISOString(), id: last.id }) : null,
  });
}
