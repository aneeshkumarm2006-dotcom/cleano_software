// POST /api/v1/announcements/:id/reactions — SET the caller's reaction (or
// clear it with null). A set, not the web's toggle, so a replay is harmless;
// idempotent on clientEventId as well.
import { SetReactionRequest, SetReactionResponse } from "@bookmops/api/v1";

import { REACTION_EMOJI, reactionState, setAnnouncementReaction } from "@/server/announcements/announcements";
import { ok } from "@/server/result";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: SetReactionRequest,
    response: SetReactionResponse,
    idempotent: true,
    limit: { name: "announcement-react", max: 60, windowMs: 60_000 },
  },
  async (ctx) => {
    const res = await setAnnouncementReaction(
      ctx.actor,
      pathId(ctx.params.announcementId),
      ctx.body.kind ? REACTION_EMOJI[ctx.body.kind] : null,
    );
    if (!res.ok) return res;
    return ok(reactionState(res.value, ctx.actor.userId));
  },
);
