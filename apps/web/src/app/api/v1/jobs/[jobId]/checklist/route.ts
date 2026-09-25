// GET /api/v1/jobs/:id/checklist — the caller's checklist for this job,
// generated on open exactly as the web's job page does.
import { ChecklistResponse } from "@bookmops/api/v1";

import { listChecklist } from "@/server/checklist/checklist";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: ChecklistResponse }, (ctx) =>
  listChecklist(ctx.actor, pathId(ctx.params.jobId)),
);
