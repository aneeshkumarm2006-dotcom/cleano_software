// GET  /api/v1/jobs/:id/on-my-way — whether this cleaner said so, and whether
//      to ask for a position.
// POST /api/v1/jobs/:id/on-my-way — say so: today's job, before clock-in,
//      once per cleaner. Idempotent on clientEventId.
import { OnMyWayRequest, OnMyWayResponse, OnMyWayState } from "@bookmops/api/v1";

import { revalidateAfterOnMyWay } from "@/server/photos/revalidate";
import { markOnMyWayFor, onMyWayState } from "@/server/on-my-way/on-my-way";
import { ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: OnMyWayState }, (ctx) =>
  onMyWayState(ctx.actor, pathId(ctx.params.jobId)),
);

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: OnMyWayRequest,
    response: OnMyWayResponse,
    idempotent: true,
    limit: { name: "on-my-way", max: 30, windowMs: 60 * 60_000 },
  },
  async (ctx) => {
    const jobId = pathId(ctx.params.jobId);
    const res = await markOnMyWayFor(ctx.actor, {
      jobId,
      coords: ctx.body.coords ? { lat: ctx.body.coords.lat, lng: ctx.body.coords.lng } : undefined,
      now: ctx.receivedAt,
      door: "phone",
    });
    if (!res.ok) return res;
    if (!res.value.alreadySent) revalidateAfterOnMyWay(jobId);
    const { sentAt, alreadySent, officeTold, clientTold, locationSaved } = res.value;
    return ok({ sentAt, alreadySent, officeTold, clientTold, locationSaved }, res.effects);
  },
);
