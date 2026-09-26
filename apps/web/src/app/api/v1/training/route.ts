// GET /api/v1/training — every active module, in the office's order, with the
// caller's own progress (server/training/training.ts).
import { TrainingListResponse } from "@bookmops/api/v1";

import { listTrainingFor } from "@/server/training/training";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: TrainingListResponse }, (ctx) =>
  listTrainingFor(ctx.actor),
);
