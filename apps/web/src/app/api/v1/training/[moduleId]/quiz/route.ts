// POST /api/v1/training/:moduleId/quiz — submit answers, marked on the server.
// Idempotent on clientEventId: a retry is not a second attempt. Three failed
// attempts in a row are followed by a 24-hour wait (429 QUIZ_COOLDOWN).
import { QuizSubmitRequest, QuizSubmitResponse } from "@bookmops/api/v1";

import { revalidateAfterTraining } from "@/server/training/revalidate";
import { submitQuizFor } from "@/server/training/training";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: QuizSubmitRequest,
    response: QuizSubmitResponse,
    idempotent: true,
    limit: { name: "training-quiz", max: 20, windowMs: 60_000 },
  },
  async (ctx) => {
    const moduleId = pathId(ctx.params.moduleId);
    const res = await submitQuizFor(ctx.actor, { moduleId, answers: ctx.body.answers, now: ctx.receivedAt });
    if (res.ok) revalidateAfterTraining(moduleId);
    return res;
  },
);
