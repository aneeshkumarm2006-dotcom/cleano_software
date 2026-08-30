import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { customSession } from "better-auth/plugins"
import { cache } from "react";
import { headers as nextHeaders } from "next/headers";

import { db } from "@/lib/org-db";
import { requestOrigin } from "@/lib/org-url";
import { sendAccountEmail } from "@/lib/email";

// better-auth doesn't ship a "role" on the user object passed to email hooks
// — fetch it once so the email goes to the right catalog row (customer vs
// provider). Defaults to CUSTOMER for unknown roles to avoid leaking
// provider-only copy to anonymous flows.
async function roleOf(userId: string): Promise<"CUSTOMER" | "PROVIDER"> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!u) return "CUSTOMER";
  // Anything that isn't a customer (CLIENT) is a provider on Cleano.
  return u.role === "CLIENT" ? "CUSTOMER" : "PROVIDER";
}

/**
 * Move a link better-auth built onto the host the browser is actually on.
 *
 * Every emailed link — password reset, "set your password" invites, address
 * verification — is built by better-auth as `${ctx.baseURL}/...`, and
 * `ctx.baseURL` is not per request. better-auth works it out once, from the
 * first request an instance ever serves (or from BETTER_AUTH_URL), and keeps
 * it. On a single-domain app that is invisible. Here it meant a TeamCleano
 * cleaner's set-password link pointed at whichever host happened to warm the
 * instance, and the reset then failed on a workspace that is not theirs.
 *
 * The callbackURL travelling inside the link has to be made absolute at the
 * same time: better-auth resolves a relative one against that same stale
 * baseURL when it redirects, which is how a link opened on the right host
 * still landed on the wrong one.
 *
 * The Host header is the source, as everywhere else in the tenancy model — it
 * is what the proxy resolves the organization from on every request.
 */
async function onRequestHost(url: string): Promise<string> {
  const origin = await requestOrigin();
  if (!origin) return url;
  try {
    const here = new URL(origin);
    const link = new URL(url);
    link.protocol = here.protocol;
    link.host = here.host;
    const callback = link.searchParams.get("callbackURL");
    if (callback && callback.startsWith("/")) {
      link.searchParams.set("callbackURL", `${here.origin}${callback}`);
    }
    return link.toString();
  } catch {
    // Not a URL we can parse. Sending the original beats sending nothing.
    return url;
  }
}

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  /**
   * Brute-force limiting, stated out loud rather than inherited.
   *
   * better-auth turns this on by default, and the default behaves differently
   * between a dev server and a production build: twenty-five wrong passwords in
   * a row against `npm run dev` are all answered 401, while the same attack on a
   * production build is cut off at the fourth with a 429. An authentication
   * control that is invisible in the environment people test in is one nobody
   * notices the day it stops working, so the numbers live here where they can be
   * read, changed and reviewed.
   *
   * Five attempts a minute per path. Enough for someone fumbling a password,
   * far too few to search a password space.
   *
   * KNOWN LIMIT: the counters are per instance, held in memory. Vercel runs
   * several, so an attacker spreading requests across them gets more attempts
   * than this number suggests. Fluid Compute reuses instances, which blunts it,
   * but the real fix for a determined attacker is a rate-limit rule on the
   * Vercel WAF in front of /api/auth/*, not this. Moving the counters into the
   * database would also work, at the cost of a write on every request.
   */
  rateLimit: {
    enabled: true,
    window: 60,
    max: 5,
  },
  advanced: {
    /**
     * Mark the session cookie Secure in production.
     *
     * better-auth works this out from `baseURL`, and ours is deliberately empty
     * — a fixed base would make the login form at company-a.useawer.com post to
     * whichever host was configured, so it has to stay relative. With no
     * baseURL there is nothing for it to inspect, and the cookie went out
     * without the flag.
     *
     * HSTS already stops a browser using plain HTTP after its first visit, so
     * this is defence in depth rather than a hole — but it is one line, and the
     * cookie it protects is a 30-day session.
     *
     * Keyed on NODE_ENV, not on a URL: local development is served over HTTP,
     * and a Secure cookie there simply would not be stored, which looks exactly
     * like a broken login.
     */
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  /**
   * Trust the address the browser is actually on, and only that one.
   *
   * better-auth refuses any state-changing request whose Origin header is not
   * on this list, which is its CSRF defence. The default list is a single
   * entry: the baseURL. Ours is deliberately unset, so better-auth fills it in
   * from the first request an instance serves and then never revisits it —
   * and if BETTER_AUTH_URL is set in the environment, from that.
   *
   * Either way it is ONE host, and this product has one per company. Every
   * cleaner signing in at `<company>.useawer.com` was answered
   * `403 INVALID_ORIGIN`, while the same POST from the one blessed host went
   * through. It was invisible in testing because the check only runs when the
   * request carries a cookie, so curl passed and browsers did not.
   *
   * Derived per request instead. The Origin header is set by the browser and
   * cannot be forged by a page on another site, so trusting the host this
   * request arrived on is exactly the check that was intended: a form on
   * evil.com posting here still sends `Origin: https://evil.com`, which will
   * not match, and neither will one company's workspace posting at another's.
   */
  trustedOrigins: (request) => {
    const host = request.headers.get("host");
    if (!host) return [];
    // A forwarded-proto header can carry a list; the first hop is the
    // browser's. Same derivation as selfOrigin() in the proxy.
    const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const isLocal =
      host.startsWith("localhost") ||
      host.includes(".localhost") ||
      host.startsWith("127.0.0.1");
    return [`${forwarded || (isLocal ? "http" : "https")}://${host}`];
  },
  // Spec item 14 (staff homescreen-app login persistence): sessions last 30
  // days and slide forward daily with use, so cleaners opening the installed
  // app day-to-day stay signed in instead of hitting a login wall.
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  /**
   * Public sign-up may only ever mint a CUSTOMER.
   *
   * This hook fires only for accounts created through better-auth's own
   * /api/auth/sign-up/email endpoint. Every staff account is created with
   * Prisma directly — provisionOrganization (OWNER), createEmployee,
   * hireApplicant, sendLoginInvites, inviteApplicantToPortal, importCsv,
   * runBookingKoalaImport — so none of them pass through here and none of
   * them change.
   *
   * That endpoint is public on every workspace subdomain, and the row it
   * creates is stamped with that host's organizationId, so signing up JOINS an
   * existing company rather than creating one. `role` defaults to EMPLOYEE in
   * the schema, and EMPLOYEE is a STAFF role: it opens the cleaner app, with
   * that company's job list, client names, full street addresses and prices.
   * So a stranger could curl themselves a cleaner's account inside any
   * customer's workspace — or inside Awer's own platform workspace, which is
   * the one precondition setStaffRole checks before granting a platformRole.
   *
   * CLIENT is the customer portal: it shows the holder their own record and
   * nothing else, which is what a stranger signing up should get. The one
   * legitimate caller, the /setup portal flow, already promotes to CLIENT
   * immediately afterwards via linkClientAccount — this just makes the account
   * correct from the moment it exists rather than one round-trip later.
   */
  user: {
    additionalFields: {
      // Declared so better-auth stops dropping it. Without this the adapter
      // strips any field it does not know, the INSERT omits the column, and
      // Prisma's `@default(EMPLOYEE)` fills it in — which is the whole bug.
      //
      // `input: false` is the other half: it stops a caller from simply
      // putting `"role": "OWNER"` in the sign-up JSON body.
      role: { type: "string", defaultValue: "CLIENT", input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({ data: { ...user, role: "CLIENT" } }),
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      const role = await roleOf(user.id);
      sendAccountEmail({
        to: user.email,
        name: user.name,
        role,
        event: "reset_password",
        link: await onRequestHost(url),
      }).catch((e) => console.error("reset_password email", e));
    },
    onPasswordReset: async ({ user }) => {
      // A completed reset always satisfies the forced first-login reset gate.
      db.user
        .update({ where: { id: user.id }, data: { mustChangePassword: false } })
        .catch((e) => console.error("clear mustChangePassword", e));
      const role = await roleOf(user.id);
      sendAccountEmail({
        to: user.email,
        name: user.name,
        role,
        event: "password_changed",
      }).catch((e) => console.error("password_changed email", e));
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const role = await roleOf(user.id);
      // For customers this maps to "Set up password" / for providers to "Email verification".
      sendAccountEmail({
        to: user.email,
        name: user.name,
        role,
        event: role === "CUSTOMER" ? "setup_password" : "email_verification",
        link: await onRequestHost(url),
      }).catch((e) => console.error("verify email", e));
    },
  },
  plugins: [customSession(async (session) => {
      if (session.user) {
        // Only fetch the role — full user record was an expensive overshoot.
        //
        // This read goes through the ORG-SCOPED client, so it misses whenever
        // the session belongs to someone who is not a member of the workspace
        // this host resolved to. That miss is the ONLY signal we get: session
        // validation itself is not tenant-bound, because Session is a
        // better-auth internal and is deliberately absent from TENANT_MODELS.
        //
        // So a miss must mean no session. It used to mean `role: 'EMPLOYEE'`,
        // which handed anyone holding any valid session — a cleaner at another
        // company, or a stranger who signed up for a free trial — a working
        // cleaner's role in every other workspace, since every guard downstream
        // checks the role and never the membership.
        const userProfile = await db.user.findUnique({
          where: { id: session.user.id },
          select: { role: true },
        });
        //
        // Returning null really does mean "no session" here. The plugin's
        // endpoint ends in `return ctx.json(fnResult)`, and uses `ctx.json(null)`
        // itself for the unauthenticated case a few lines above. The cast only
        // satisfies a callback type that is narrower than the runtime; if a
        // future version ever stopped honouring it, the fallback would be a
        // session carrying no role at all, and every isXRole() guard still
        // refuses that.
        if (!userProfile) return null as unknown as typeof session;

        return {
          ...session,
          user: {
            ...session.user,
            role: userProfile.role,
          },
        };
      }
      return session;
  })],
  secret: process.env.BETTER_AUTH_SECRET!,
});

// React `cache` deduplicates calls within a single server render. With this,
// a layout + page both calling `getCachedSession()` hit the DB once, not twice.
export const getCachedSession = cache(async () => {
  return auth.api.getSession({ headers: await nextHeaders() });
});

// Transparently dedupe the 95+ existing `auth.api.getSession(...)` callsites
// across pages and server actions by replacing the original with a cached
// version keyed on the headers' cookie. Same shape and return type — callers
// don't need to change.
const _origGetSession = auth.api.getSession.bind(auth.api);
type GetSessionArgs = Parameters<typeof _origGetSession>;
const _cachedByCookie = cache((cookieKey: string, args: GetSessionArgs) => {
  // cookieKey is only here to participate in cache keying (per-request,
  // since React cache resets between requests). We ignore it in the call.
  void cookieKey;
  return _origGetSession(...args);
});
auth.api.getSession = ((...args: GetSessionArgs) => {
  const hdrs = args[0]?.headers as Headers | undefined;
  const cookie =
    (hdrs && typeof hdrs.get === "function" && hdrs.get("cookie")) || "";
  return _cachedByCookie(cookie, args);
}) as typeof _origGetSession;

type RoleBearer = { role?: string | null } | null | undefined;

export function isOpsManager(user: RoleBearer): boolean {
  return user?.role === "OPS_MANAGER";
}

export function isFieldLead(user: RoleBearer): boolean {
  return user?.role === "FIELD_LEAD";
}

export function isCleaner(user: RoleBearer): boolean {
  return user?.role === "EMPLOYEE";
}