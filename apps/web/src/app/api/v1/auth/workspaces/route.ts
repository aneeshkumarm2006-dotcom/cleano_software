// POST /api/v1/auth/workspaces — which companies this email and password
// open (API_V1.md §2). Platform host; creates no session.
//
// The same service as the web's front door: the password is checked against
// the account in each company and only matches are returned, with a dummy
// check so timing says nothing, and limits per email and per address. The
// platform workspace is never returned, and apiOrigin is always the
// canonical company address.
import { WorkspacesRequest, WorkspacesResponse } from "@bookmops/api/v1";

import { discoverWorkspacesFor } from "@/server/auth/discover";
import { V1Error } from "@/server/v1/http";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

/** Pad to this many password checks, so the time taken doesn't count companies. */
const MIN_CHECKS = 3;

export const POST = v1Route(
  {
    host: "platform",
    access: "public",
    body: WorkspacesRequest,
    response: WorkspacesResponse,
    ipLimit: { name: "workspaces", max: 30, windowMs: 60_000 },
  },
  async (ctx) => {
    const outcome = await discoverWorkspacesFor(ctx.body.email, ctx.body.password, ctx.ip, {
      excludePlatform: true,
      minChecks: MIN_CHECKS,
    });
    if (outcome.kind === "limited") {
      throw new V1Error(429, "RATE_LIMITED", "Too many attempts. Wait a minute and try again.", true, {
        "Retry-After": "60",
      });
    }
    const workspaces =
      outcome.kind === "ok"
        ? outcome.workspaces
            .filter((w) => isHttpsOrigin(w.origin))
            .map((w) => ({ orgId: w.orgId, name: w.name, apiOrigin: w.origin }))
        : [];
    // A refusal is an empty list, not an error: the app says "email or
    // password is incorrect" either way, and so does the status code.
    return { ok: true, value: { workspaces } };
  },
);

/** Only a real company address is handed to an app that will send passwords to it. */
function isHttpsOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || process.env.NODE_ENV !== "production") && u.origin === value;
  } catch {
    return false;
  }
}
