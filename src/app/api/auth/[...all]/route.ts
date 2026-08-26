import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { getCurrentOrg, getOrgSlug } from "@/lib/org";

const handler = toNextJsHandler(auth);

/**
 * Refuse authentication for a workspace that cannot be used, before better-auth
 * tries.
 *
 * Auth runs through the tenant-scoped client, so on a suspended, cancelled or
 * unknown workspace the very first user lookup is refused — correctly, since
 * querying a workspace nobody may use is exactly what should not happen. But
 * better-auth catches that itself and answers with a bare 500, so wrapping this
 * route in a try/catch achieves nothing: the throw never escapes.
 *
 * Hence the check happens first. A suspended company's owner typing their
 * password is not an edge case — it is what happens the morning after a
 * suspension — and they should be told their workspace is on hold rather than
 * shown a crash and left wondering whether they have forgotten their password.
 *
 * 503, not 401: the credentials were never the problem, and "wrong password"
 * would send someone hunting for one that works.
 */
async function unusableWorkspace(): Promise<Response | null> {
  const org = await getCurrentOrg();

  if (org?.status === "ACTIVE") return null;

  const message = !org
    ? "There is no workspace at this address."
    : org.status === "SUSPENDED"
      ? "This workspace is on hold. Please contact billing to restore access."
      : org.status === "CANCELLED"
        ? "This workspace has been closed."
        : "This workspace is not set up yet.";

  return Response.json(
    {
      error: {
        message,
        code: "WORKSPACE_UNAVAILABLE",
        // The slug, not the company name: this is unauthenticated, so it must
        // not hand out anything the caller did not already type into the bar.
        workspace: await getOrgSlug(),
      },
    },
    { status: 503 },
  );
}

export async function POST(req: Request): Promise<Response> {
  return (await unusableWorkspace()) ?? handler.POST(req);
}

export async function GET(req: Request): Promise<Response> {
  return (await unusableWorkspace()) ?? handler.GET(req);
}
