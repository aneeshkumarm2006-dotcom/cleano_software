// GET /api/v1/manager/team/day?date=YYYY-MM-DD — every job on one company day,
// with its crew's live state (packages/api/src/v1/manager-team.ts).
//
// TEAM_VIEW. The scope is dayScopeFor(role, date is today): OWNER and ADMIN
// the company; OPS_MANAGER the company today and their own jobs on any other
// date; FIELD_LEAD their group, names only for anyone outside it. No money.
import { LocalDate, TeamDayResponse } from "@bookmops/api/v1";
import { z } from "zod";

import { teamDayFor } from "@/server/manager/team";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

const DayQuery = z.object({ date: LocalDate.optional() });

export const GET = v1Route(
  { host: "tenant", access: { capability: "TEAM_VIEW" }, query: DayQuery, response: TeamDayResponse },
  (ctx) => teamDayFor(ctx.actor, ctx.query.date, ctx.receivedAt),
);
