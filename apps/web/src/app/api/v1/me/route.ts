// GET /api/v1/me — who is signed in, and for which company.
//
// Every staff role, crew and office, and while a password change is pending:
// it is how the app picks its side from the role and learns that a new
// password comes first. Any other role is 403 ROLE_NOT_ALLOWED, which the app
// turns into "signed out, and why".
import { MeResponse } from "@bookmops/api/v1";

import { meFor } from "@/server/account/me";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: "anyStaff", allowPendingPasswordChange: true, response: MeResponse },
  (ctx) => meFor(ctx.actor, ctx.org),
);
