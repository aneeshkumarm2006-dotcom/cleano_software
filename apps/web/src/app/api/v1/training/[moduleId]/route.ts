// GET /api/v1/training/:moduleId — one active module to work through. Option
// text only: which answer is right never leaves the server.
import { TrainingModuleDetail } from "@bookmops/api/v1";

import { trainingModuleFor } from "@/server/training/training";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: TrainingModuleDetail }, (ctx) =>
  trainingModuleFor(ctx.actor, pathId(ctx.params.moduleId)),
);
