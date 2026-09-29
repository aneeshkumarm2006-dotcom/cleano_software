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

/**
 * Endpoints this product never uses, answered 404 before anything else runs.
 *
 * `expo-authorization-proxy` (from @better-auth/expo) is an open redirect that
 * also sets an attacker-chosen `oauth_state` cookie; there is no OAuth sign-in
 * here to need it. `disabledPaths` in lib/auth.ts refuses it as well; this is
 * the belt to that brace, and it also catches case and encoding variants.
 */
const REFUSED_AUTH_PATHS = ["expo-authorization-proxy"];

function isRefusedAuthPath(url: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname).toLowerCase();
  } catch {
    return true;
  }
  return REFUSED_AUTH_PATHS.some((p) => path.includes(p));
}

const notFound = () => new Response("Not Found", { status: 404 });

/**
 * Bookmops Pro's `expo-origin` header, copied into Origin here rather than by
 * the Expo plugin.
 *
 * The plugin does it with `new Request(request, { headers })`, which on
 * Vercel's Node runtime throws for any request with a body (a streamed body
 * needs `duplex: "half"`). better-auth turns the throw into a bare 500, and the
 * app shows that as "Email or password is incorrect": every phone sign-in
 * failed after its password had already been checked. Buffering the body first
 * sidesteps it, and lib/auth.ts switches the plugin's own copy off.
 *
 * This only names the origin. Whether `bookmopspro://` is trusted, and on which
 * paths, is still decided by trustedOrigins in lib/auth.ts.
 */
async function withAppOrigin(req: Request): Promise<Request> {
  const appOrigin = req.headers.get("expo-origin");
  if (!appOrigin || req.headers.get("origin")) return req;
  const headers = new Headers(req.headers);
  headers.set("origin", appOrigin);
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  return new Request(req.url, { method: req.method, headers, body });
}

export async function POST(req: Request): Promise<Response> {
  if (isRefusedAuthPath(req.url)) return notFound();
  return (await unusableWorkspace()) ?? handler.POST(await withAppOrigin(req));
}

export async function GET(req: Request): Promise<Response> {
  if (isRefusedAuthPath(req.url)) return notFound();
  return (await unusableWorkspace()) ?? handler.GET(await withAppOrigin(req));
}
