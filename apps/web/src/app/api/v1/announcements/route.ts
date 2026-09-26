// GET /api/v1/announcements?cursor=… — the noticeboard, pinned first, with
// only the caller's own read and reaction state. Every staff role.
import { AnnouncementsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listAnnouncementsFor } from "@/server/announcements/announcements";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const AnnouncementsQuery = z.object({ cursor: z.string().max(512).optional() });

export const GET = v1Route(
  { host: "tenant", access: "anyStaff", query: AnnouncementsQuery, response: AnnouncementsResponse },
  (ctx) => listAnnouncementsFor(ctx.actor, ctx.query.cursor),
);
