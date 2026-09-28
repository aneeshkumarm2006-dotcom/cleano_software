// GET /api/v1/jobs/available?when=all|week|weekend&cursor=…
//
// Open work the caller could claim right now, built from the same rule the
// claim enforces (server/available/board.ts). Staff only: an APPLICANT or
// CLIENT never reads the board. The area only, never the street, the client
// or the price.
import { AVAILABLE_WHEN, AvailableJobsResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { listAvailableJobs } from "@/server/available/board";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const AvailableQuery = z.object({
  when: z.enum(AVAILABLE_WHEN).optional(),
  cursor: z.string().max(512).optional(),
});

export const GET = v1Route(
  { host: "tenant", access: "staff", query: AvailableQuery, response: AvailableJobsResponse },
  (ctx) => listAvailableJobs(ctx.actor, { when: ctx.query.when ?? "all", cursor: ctx.query.cursor }, ctx.receivedAt),
);
