// POST /api/v1/announcements/read — mark announcements the caller has seen.
// Idempotent by nature: a read is never moved, except one that predates the
// last edit. Unknown and other companies' ids are ignored; at most 200.
import { MarkAnnouncementsReadRequest, MarkAnnouncementsReadResponse } from "@bookmops/api/v1";

import { markAnnouncementsReadFor, unreadCountFor } from "@/server/announcements/announcements";
import { ok } from "@/server/result";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: MarkAnnouncementsReadRequest,
    response: MarkAnnouncementsReadResponse,
    limit: { name: "announcements-read", max: 60, windowMs: 60_000 },
  },
  async (ctx) => {
    const res = await markAnnouncementsReadFor(ctx.actor, ctx.body.ids, ctx.receivedAt);
    if (!res.ok) return res;
    return ok({ marked: res.value.marked, unreadCount: await unreadCountFor(ctx.actor.userId) });
  },
);
