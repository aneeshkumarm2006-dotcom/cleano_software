import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Finish a sign-in that started on Awer's front door.
 *
 * `useawer.com` can work out which workspace someone belongs to (see
 * sign-in/discover.ts), but it cannot sign them in there. A session cookie is
 * host-only by design -- that is the same rule that stops one company's login
 * working at another's, and we verified it holds in production -- so the
 * platform page cannot mint a cookie for `<slug>.useawer.com`.
 *
 * So the browser finishes the job: the front door posts the credentials here,
 * on the workspace's own host, and better-auth signs the person in exactly as
 * it would have if they had typed them on this page. `useawer.com` and
 * `<slug>.useawer.com` share a registrable domain, so that POST is same-site
 * and the cookie this sets applies normally.
 *
 * Deliberately NOT a token handoff. A one-time token would mean minting
 * credentials on one host and redeeming them on another, with a token table, an
 * expiry, and a replay window to get right. Re-posting the password the person
 * just typed keeps better-auth as the only thing that ever decides whether a
 * password is correct.
 */

/**
 * Same in-memory caveat as everywhere else: per instance, and Vercel runs
 * several. better-auth's own limiter guards `/api/auth/*` and does not reach a
 * route that calls `auth.api` directly, so this endpoint would otherwise be an
 * unmetered way to guess passwords.
 */
const ATTEMPTS = new Map<string, { n: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hit = ATTEMPTS.get(key);
  if (!hit || hit.resetAt < now) {
    ATTEMPTS.set(key, { n: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  hit.n += 1;
  return hit.n > MAX_ATTEMPTS;
}

/**
 * Is the page that posted these credentials one of ours?
 *
 * This route exists to be called cross-HOST — the front door at the apex posts
 * to the workspace's subdomain, which is why it cannot sit behind better-auth's
 * own origin check (that runs only on /api/auth/* routes, and a direct
 * `auth.api` call skips it). But cross-host is not cross-SITE: the apex and
 * every workspace share a registrable domain, so the Origin a browser stamps on
 * the POST must be the request's own host, its parent, or a sibling under it.
 *
 * Without this, any web page could auto-submit a hidden form here and log a
 * visitor's browser into an account the attacker controls. The security review
 * traced that chain and found /api/post-signin's staff-door bounce breaks it —
 * every role an outsider can mint gets signed straight back out — so this is
 * defence in depth, not the only thing holding the door. It stops the chain at
 * the first link instead of the last.
 *
 * A MISSING Origin header is allowed through. Non-browser clients send none and
 * are not a CSRF vector (CSRF is about riding a victim's browser, and browsers
 * DO send Origin on cross-site form POSTs); rejecting on absence would break
 * odd browsers and privacy extensions for no security gain. "null" — sandboxed
 * iframes, data: URLs — fails URL parsing and is rejected, which is right.
 */
function sameSiteOrigin(req: NextRequest): boolean {
  const raw = req.headers.get("origin");
  if (!raw) return true;

  let originHost: string;
  try {
    originHost = new URL(raw).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  const reqHost = (req.headers.get("host") ?? "")
    .split(":")[0]
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!originHost || !reqHost) return false;

  return (
    originHost === reqHost ||
    reqHost.endsWith(`.${originHost}`) ||
    originHost.endsWith(`.${reqHost}`)
  );
}

function backToSignIn(req: NextRequest, reason: string) {
  const url = new URL("/sign-in", req.nextUrl.origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  if (!sameSiteOrigin(req)) return backToSignIn(req, "invalid");

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) return backToSignIn(req, "rate");

  let email = "";
  let password = "";
  try {
    const form = await req.formData();
    email = String(form.get("email") ?? "").trim().toLowerCase();
    password = String(form.get("password") ?? "");
  } catch {
    return backToSignIn(req, "invalid");
  }
  if (!email || !password) return backToSignIn(req, "invalid");

  let signIn: Response;
  try {
    signIn = await auth.api.signInEmail({
      body: { email, password },
      headers: req.headers,
      asResponse: true,
    });
  } catch {
    // Wrong password, or no such user IN THIS WORKSPACE. Both look the same.
    return backToSignIn(req, "credentials");
  }

  if (!signIn.ok) return backToSignIn(req, "credentials");

  // Hand the browser onwards, carrying better-auth's Set-Cookie headers. The
  // role decides where "onwards" is, and /api/post-signin already knows how to
  // work that out, so this does not need to.
  const res = NextResponse.redirect(new URL("/api/post-signin", req.nextUrl.origin), 303);
  for (const cookie of signIn.headers.getSetCookie()) {
    res.headers.append("set-cookie", cookie);
  }
  return res;
}
