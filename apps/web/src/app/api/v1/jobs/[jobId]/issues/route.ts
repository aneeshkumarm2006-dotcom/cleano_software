// GET  /api/v1/jobs/:id/issues?cursor=… — the caller's own reports on the job.
// POST /api/v1/jobs/:id/issues — report a problem, optionally with a photo
//      (a signed upload's key). Idempotent on clientEventId; 10 an hour.
import { JobIssue, JobIssuesResponse, ReportIssueRequest } from "@bookmops/api/v1";
import { z } from "zod";

import { listMyJobIssues, reportJobIssueFor } from "@/server/issues/issues";
import { revalidatePhotoSurfaces } from "@/server/photos/revalidate";
import { ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const IssuesQuery = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: "staff", query: IssuesQuery, response: JobIssuesResponse },
  (ctx) => listMyJobIssues(ctx.actor, pathId(ctx.params.jobId), ctx.query.cursor),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: ReportIssueRequest,
    response: JobIssue,
    idempotent: true,
    // URGENT reports email the office at once (API_V1.md §4).
    limit: { name: "issue-report", max: 10, windowMs: 60 * 60_000 },
  },
  async (ctx) => {
    const jobId = pathId(ctx.params.jobId);
    const res = await reportJobIssueFor(ctx.actor, {
      jobId,
      category: ctx.body.category,
      urgency: ctx.body.urgency,
      description: ctx.body.note,
      photoKey: ctx.body.photoKey ?? null,
      orgSlug: ctx.org.slug,
      door: "phone",
      now: ctx.receivedAt,
    });
    if (!res.ok) return res;
    revalidatePhotoSurfaces(jobId);
    return ok(res.value.issue, res.effects);
  },
);
