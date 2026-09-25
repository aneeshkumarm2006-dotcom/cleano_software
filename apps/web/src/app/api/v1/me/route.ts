// GET /api/v1/me — who is signed in, and for which company.
//
// Answers any role of this company, and while a password change is pending:
// it is how the app learns the role (and signs out one it doesn't serve) and
// that a new password comes first.
import { MeResponse } from "@bookmops/api/v1";

import { meFor } from "@/server/account/me";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "tenant", access: "signedIn", allowPendingPasswordChange: true, response: MeResponse },
  (ctx) => meFor(ctx.actor, ctx.org),
);
