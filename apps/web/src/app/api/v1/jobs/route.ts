// GET /api/v1/jobs?scope=upcoming|past&cursor=…
// GET /api/v1/jobs?from=YYYY-MM-DD&to=YYYY-MM-DD&cursor=…   (the calendar)
//
// Only the caller's own jobs. `scope` and `from`/`to` are alternatives: both
// is 400, one of from/to alone is 400, and neither means scope=upcoming, as
// before the calendar query existed.
import { JOB_SCOPES, JobsListResponse, LocalDate } from "@bookmops/api/v1";
import { z } from "zod";

import { listMyJobs } from "@/server/jobs/list";
import { failure } from "@/server/result";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const JobsQuery = z.object({
  scope: z.enum(JOB_SCOPES).optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  cursor: z.string().max(512).optional(),
});

export const GET = v1Route(
  { host: "tenant", access: "staff", query: JobsQuery, response: JobsListResponse },
  async (ctx) => {
    const { scope, from, to, cursor } = ctx.query;
    const ranged = from !== undefined || to !== undefined;
    if (ranged && scope !== undefined) {
      return failure(400, "VALIDATION_FAILED", "Ask for a scope or a date range, not both.");
    }
    if (ranged) {
      if (!from || !to) return failure(400, "VALIDATION_FAILED", "A date range needs both from and to.");
      return listMyJobs(ctx.actor, { kind: "range", from, to, cursor }, ctx.receivedAt);
    }
    return listMyJobs(ctx.actor, { kind: "scope", scope: scope ?? "upcoming", cursor }, ctx.receivedAt);
  },
);
