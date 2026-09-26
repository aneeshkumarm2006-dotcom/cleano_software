// POST /api/v1/jobs/available/:id/claim — take a spot on an open job.
// Idempotent on the body's clientEventId; 10 a minute per person.
//
// Every rule is re-checked from the database under a row lock, in one
// transaction with the write (server/available/claim.ts), so two cleaners
// racing for the last spot get exactly one claim. The office's notice is an
// effect, sent after the commit and never for a replay.
import { ClaimJobRequest, ClaimJobResponse } from "@bookmops/api/v1";
import { after } from "next/server";

import { claimJobService } from "@/server/available/claim";
import { flushEffects } from "@/server/effects";
import { revalidateAfterClaim } from "@/server/available/revalidate";
import { summarise, SUMMARY_SELECT } from "@/server/jobs/summary";
import { findMyJob } from "@/server/jobs/detail";
import { failure, ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

/** Claims race other cleaners for the same job (API_V1.md §4). */
const CLAIM_LIMIT = { name: "claim", max: 10, windowMs: 60_000 };

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: ClaimJobRequest,
    response: ClaimJobResponse,
    idempotent: true,
    limit: CLAIM_LIMIT,
  },
  async (ctx) => {
    const jobId = pathId(ctx.params.jobId);
    const result = await claimJobService(ctx.actor, { jobId, now: ctx.receivedAt });
    if (!result.ok) return result;
    revalidateAfterClaim();

    // The job, now the caller's, as My jobs shows it: full address included.
    const job = await findMyJob(ctx.actor, jobId, SUMMARY_SELECT);
    if (!job) {
      // Committed, but out of the caller's scope on the read-back: only
      // possible if the office changed the job in between (a quote sent back
      // for review, say). The claim stands, so the office still hears of it;
      // the phone is told the job isn't available, and a replay says the same.
      after(() => flushEffects(ctx.org, result.effects));
      return failure(409, "NOT_AVAILABLE", "This job is no longer available");
    }
    const [summary] = await summarise([job], ctx.actor.userId);
    return ok({ job: summary }, result.effects);
  },
);
