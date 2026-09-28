// POST /api/v1/training/:moduleId/progress — "I've watched the video". Stored
// as self-attested; only ever raises progress. Idempotent on clientEventId.
import { TrainingProgress, TrainingProgressRequest } from "@bookmops/api/v1";

import { revalidateAfterTraining } from "@/server/training/revalidate";
import { setTrainingProgressFor } from "@/server/training/training";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: TrainingProgressRequest,
    response: TrainingProgress,
    idempotent: true,
    limit: { name: "training-progress", max: 60, windowMs: 60_000 },
  },
  async (ctx) => {
    const moduleId = pathId(ctx.params.moduleId);
    const res = await setTrainingProgressFor(ctx.actor, {
      moduleId,
      videoProgress: ctx.body.videoProgress,
      markComplete: ctx.body.markComplete,
      now: ctx.receivedAt,
    });
    if (res.ok) revalidateAfterTraining(moduleId);
    return res;
  },
);
