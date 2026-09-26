/**
 * API v1 integration tests, against a running server connected to STAGING.
 *
 *   # 1. a local server on :3100 whose DATABASE_URL is the staging app role
 *   # 2. then:
 *   FIXTURE_DATABASE_URL="$STAGING_DIRECT_URL" npx tsx scripts/api-v1-integration.ts
 *
 * It creates two throwaway companies (scripts/api-v1/fixture.ts), runs every
 * check against http://<slug>.localhost:3100, and deletes both companies at
 * the end, pass or fail. Pass --keep to leave them for a look.
 *
 * Covers the v1Route gates (401, 403 inactive / role / password change,
 * 404 cross-tenant and wrong host, 409 in flight, 415 / 403 CSRF, 422 key
 * reuse, 426) and each endpoint's happy path and not-yours case, including
 * the offline clock rules of API_V1.md §6.
 *
 * Not in `npm run verify` on purpose: that sweep is code-only.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

import { createFixture, openDb, PASSWORD, removeFixture, SLUG_A, SLUG_B, type Fixture } from "./api-v1/fixture";
import { runTalkChecks } from "./api-v1/talk";
import { recordChecks } from "./api-v1/record";
import { mediaChecks } from "./api-v1/media";

const PORT = Number(process.env.V1_PORT ?? 3100);
const APEX = `localhost:${PORT}`;
const HOST_A = `${SLUG_A}.localhost:${PORT}`;
const HOST_B = `${SLUG_B}.localhost:${PORT}`;
const KEEP = process.argv.includes("--keep");

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`FAIL  ${name}${detail === undefined ? "" : `\n        ${JSON.stringify(detail).slice(0, 600)}`}`);
  }
}

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

let retries = 0;

/**
 * One request, retried on a 5xx up to three times. Staging's pooler drops
 * connections from this network now and then; a 500 frees the idempotency
 * key, so a retry is safe, and every retry is counted in the summary.
 */
async function call(
  method: string,
  host: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string>; noAppHeaders?: boolean } = {},
): Promise<Res> {
  for (let attempt = 1; ; attempt++) {
    const res = await callOnce(method, host, path, opts);
    if (res.status < 500 || attempt >= 4) return res;
    retries++;
    console.log(`  (retry ${attempt}: ${method} ${path} answered ${res.status})`);
    await new Promise((r) => setTimeout(r, 3_000 * attempt));
  }
}

function callOnce(
  method: string,
  host: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string>; noAppHeaders?: boolean } = {},
): Promise<Res> {
  const payload = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    Host: host,
    Accept: "application/json",
    ...(opts.noAppHeaders ? {} : { "X-App-Version": "1.0.0 (1)", "X-App-Platform": "ios" }),
    ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    ...opts.headers,
  };
  for (const [k, v] of Object.entries(headers)) if (v === "") delete headers[k];
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let body: unknown = undefined;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text });
      });
    });
    req.on("error", reject);
    req.setTimeout(400_000, () => req.destroy(new Error(`timeout ${method} ${path}`)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function sessionCookie(res: Res): string | null {
  const set = res.headers["set-cookie"] ?? [];
  for (const c of set) {
    const m = /^((?:__Secure-)?better-auth\.session_token)=([^;]+)/.exec(c);
    if (m) return `${m[1]}=${m[2]}`;
  }
  return null;
}

async function signIn(host: string, email: string, password = PASSWORD, expo = false): Promise<string> {
  const res = await call("POST", host, "/api/auth/sign-in/email", {
    body: { email, password },
    noAppHeaders: true,
    headers: expo ? { "expo-origin": "bookmopspro://" } : { Origin: `http://${host}` },
  });
  const cookie = sessionCookie(res);
  if (res.status !== 200 || !cookie) throw new Error(`sign-in ${email} failed: ${res.status} ${res.text.slice(0, 200)}`);
  return cookie;
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const event = (msAgo = 0, id = randomUUID()) => ({
  clientEventId: id,
  occurredAt: iso(msAgo),
  clock: { source: "synced" as const, offsetMs: 0 },
});
const post = (host: string, path: string, cookie: string, body: { clientEventId?: string; [k: string]: unknown }, key?: string) =>
  call("POST", host, path, {
    cookie,
    body,
    headers: key || body.clientEventId ? { "Idempotency-Key": key ?? body.clientEventId! } : {},
  });

const near = (a: Date | string | null | undefined, b: Date | string, ms = 5_000) =>
  !!a && Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= ms;

async function main() {
  const db = openDb();
  let fx: Fixture | null = null;
  try {
    // The server must be up before anything is created.
    const up = await call("GET", APEX, "/api/v1/meta").catch(() => null);
    if (!up) throw new Error(`no server on :${PORT}`);

    fx = await createFixture(db);
    console.log(`fixture: ${SLUG_A} ${fx.orgA.id}, ${SLUG_B} ${fx.orgB.id}`);
    const F = fx;
    const job = (id: string) => `/api/v1/jobs/${id}`;

    // ── Platform ──────────────────────────────────────────────────────────
    {
      const r = await call("GET", APEX, "/api/v1/meta", { noAppHeaders: true });
      check("meta: 200 without an app version", r.status === 200 && !!r.body?.apps?.pro?.minSupportedVersion, r.body);
      check("meta: carries a request id", typeof r.headers["x-request-id"] === "string");
      check("meta: never cached", r.headers["cache-control"] === "no-store");
    }
    {
      const r = await call("POST", APEX, "/api/v1/auth/workspaces", {
        body: { email: F.users.cleaner.email, password: PASSWORD },
      });
      const ws = r.body?.workspaces ?? [];
      check(
        "workspaces: the right password finds the company, with its own origin",
        r.status === 200 && ws.length === 1 && ws[0].orgId === F.orgA.id && ws[0].apiOrigin === `http://${HOST_A}`,
        r.body,
      );
      const wrong = await call("POST", APEX, "/api/v1/auth/workspaces", {
        body: { email: F.users.cleaner.email, password: "not-the-password" },
      });
      check("workspaces: a wrong password is an empty list", wrong.status === 200 && wrong.body?.workspaces?.length === 0, wrong.body);
      const unknown = await call("POST", APEX, "/api/v1/auth/workspaces", {
        body: { email: `nobody-${randomUUID()}@nowhere.test`, password: "x" },
      });
      check("workspaces: an unknown email is the same empty list", unknown.status === 200 && unknown.body?.workspaces?.length === 0);
      const bad = await call("POST", APEX, "/api/v1/auth/workspaces", { body: { email: "not-an-email", password: "x" } });
      check("workspaces: a malformed body is 400", bad.status === 400 && bad.body?.error?.code === "VALIDATION_FAILED", bad.body);
    }
    {
      const before = await db.verification.count({ where: { value: F.users.cleaner.id } });
      const r = await call("POST", APEX, "/api/v1/auth/forgot-password", { body: { email: F.users.cleaner.email } });
      const unknown = await call("POST", APEX, "/api/v1/auth/forgot-password", { body: { email: "nobody@nowhere.test" } });
      check("forgot-password: 200 { ok: true }", r.status === 200 && r.body?.ok === true, r.body);
      check("forgot-password: an unknown address answers the same", unknown.status === 200 && unknown.text === r.text);
      let after = before;
      for (let i = 0; i < 20 && after === before; i++) {
        await new Promise((res) => setTimeout(res, 500));
        after = await db.verification.count({ where: { value: F.users.cleaner.id } });
      }
      check("forgot-password: a reset token was made for that company's account", after === before + 1, { before, after });
    }

    // ── Sign-in from the app ──────────────────────────────────────────────
    const cookie = await signIn(HOST_A, F.users.cleaner.email, PASSWORD, true);
    check("sign-in: the Expo origin signs in at the company's address", !!cookie);
    {
      // A cookie-bearing sign-out from the app's scheme is trusted...
      const extra = await signIn(HOST_A, F.users.cleaner.email, PASSWORD, true);
      const out = await call("POST", HOST_A, "/api/auth/sign-out", {
        cookie: extra,
        body: {},
        noAppHeaders: true,
        headers: { "expo-origin": "bookmopspro://" },
      });
      check("sign-out: the app scheme is a trusted origin for sign-out", out.status === 200, out.text.slice(0, 200));
      // ...but only there: not as the origin of a cookie-bearing reset...
      const reset = await call("POST", HOST_A, "/api/auth/request-password-reset", {
        cookie,
        body: { email: F.users.cleaner.email, redirectTo: "/reset-password" },
        noAppHeaders: true,
        headers: { "expo-origin": "bookmopspro://" },
      });
      check("auth: the app scheme is not a trusted origin off sign-in/sign-out", reset.status === 403, reset.text.slice(0, 200));
      // ...and never as a redirect target, which would carry a token to
      // whichever app claimed the scheme.
      const redirect = await call("POST", HOST_A, "/api/auth/request-password-reset", {
        body: { email: F.users.cleaner.email, redirectTo: "bookmopspro://reset" },
        noAppHeaders: true,
        headers: { Origin: `http://${HOST_A}` },
      });
      check("auth: the app scheme is refused as a redirect target", redirect.status === 403, redirect.text.slice(0, 200));
      const signInRedirect = await call("POST", HOST_A, "/api/auth/sign-in/email", {
        body: { email: F.users.cleaner.email, password: PASSWORD, callbackURL: "bookmopspro://x" },
        noAppHeaders: true,
        headers: { "expo-origin": "bookmopspro://", Cookie: "" },
      });
      check("auth: sign-in trusts the scheme as origin only if no callback asks for it", signInRedirect.status === 200 || signInRedirect.status === 403, signInRedirect.status);
    }

    // ── Gates ─────────────────────────────────────────────────────────────
    {
      const r = await call("GET", HOST_A, "/api/v1/me");
      check("gate 401: no session", r.status === 401 && r.body?.error?.code === "UNAUTHENTICATED", r.body);
      check("gate: the envelope carries the request id", r.body?.requestId === r.headers["x-request-id"]);
    }
    {
      const r = await call("GET", HOST_A, "/api/v1/me", { cookie, headers: { "X-App-Version": "0.9.0 (1)" } });
      check("gate 426: an app below the minimum", r.status === 426 && r.body?.error?.code === "UPDATE_REQUIRED", r.body);
      const none = await call("GET", HOST_A, "/api/v1/me", { cookie, headers: { "X-App-Version": "" } });
      check("gate: no app version is 400", none.status === 400 && none.body?.error?.code === "APP_VERSION_REQUIRED", none.body);
    }
    {
      const r = await call("GET", APEX, "/api/v1/me", { cookie });
      check("gate 404: a company route on the platform host", r.status === 404, r.body);
      const s = await call("GET", `nosuchcompany.localhost:${PORT}`, "/api/v1/me", { cookie });
      check("gate 403: an unknown company is WORKSPACE_SUSPENDED", s.status === 403 && s.body?.error?.code === "WORKSPACE_SUSPENDED", s.body);
    }
    {
      const r = await call("GET", HOST_B, "/api/v1/me", { cookie });
      check("gate 401: a session from another company", r.status === 401, r.body);
    }
    {
      const e = event();
      const plain = await call("POST", HOST_A, `${job(F.jobs.mine)}/clock-in`, {
        cookie,
        body: JSON.stringify(e),
        headers: { "Content-Type": "text/plain", "Idempotency-Key": e.clientEventId },
      });
      check("gate CSRF: a text/plain body is refused", plain.status === 415, plain.body);
      const noPlatform = await call("POST", HOST_A, `${job(F.jobs.mine)}/clock-in`, {
        cookie,
        body: e,
        headers: { "X-App-Platform": "", "Idempotency-Key": e.clientEventId },
      });
      check("gate CSRF: no X-App-Platform is refused", noPlatform.status === 403 && noPlatform.body?.error?.code === "CSRF_REJECTED", noPlatform.body);
      const sibling = await call("POST", HOST_A, `${job(F.jobs.mine)}/clock-in`, {
        cookie,
        body: e,
        headers: { Origin: `http://${HOST_B}`, "Idempotency-Key": e.clientEventId },
      });
      check("gate CSRF: a POST from a sibling company's origin is refused", sibling.status === 403, sibling.body);
      const sameSite = await call("POST", HOST_A, `${job(F.jobs.mine)}/clock-in`, {
        cookie,
        body: e,
        headers: { "Sec-Fetch-Site": "same-site", "Idempotency-Key": e.clientEventId },
      });
      check("gate CSRF: Sec-Fetch-Site same-site is refused", sameSite.status === 403, sameSite.body);
      const noKey = await call("POST", HOST_A, `${job(F.jobs.mine)}/clock-in`, { cookie, body: e });
      check("gate: a mutation without an Idempotency-Key is 400", noKey.status === 400 && noKey.body?.error?.code === "IDEMPOTENCY_KEY_REQUIRED", noKey.body);
      const nothingHappened = await db.jobWorkSession.count({ where: { jobId: F.jobs.mine } });
      check("gate: none of the refused requests clocked anyone in", nothingHappened === 0);
    }
    {
      const client = await signIn(HOST_A, F.users.client.email);
      const r = await call("GET", HOST_A, "/api/v1/today", { cookie: client });
      check("gate 403: a CLIENT on a staff route", r.status === 403 && r.body?.error?.code === "ROLE_NOT_ALLOWED", r.body);
      const me = await call("GET", HOST_A, "/api/v1/me", { cookie: client });
      check("me: a CLIENT is refused /me with a reason the app can show", me.status === 403 && me.body?.error?.code === "ROLE_NOT_ALLOWED", me.body);
      // The role is read from the database on every request, not the session.
      await db.user.update({ where: { id: F.users.client.id }, data: { role: "EMPLOYEE" } });
      const promoted = await call("GET", HOST_A, "/api/v1/today", { cookie: client });
      await db.user.update({ where: { id: F.users.client.id }, data: { role: "CLIENT" } });
      const demoted = await call("GET", HOST_A, "/api/v1/today", { cookie: client });
      check(
        "gate: a role changed in the database applies on the next request, same session",
        promoted.status === 200 && demoted.status === 403 && demoted.body?.error?.code === "ROLE_NOT_ALLOWED",
        { promoted: promoted.status, demoted: demoted.body },
      );
      const applicant = await signIn(HOST_A, F.users.applicant.email);
      const a = await call("GET", HOST_A, "/api/v1/jobs", { cookie: applicant });
      check("gate 403: an APPLICANT on a staff route", a.status === 403 && a.body?.error?.code === "ROLE_NOT_ALLOWED", a.body);
      const owner = await signIn(HOST_A, F.users.owner.email);
      const o = await call("GET", HOST_A, "/api/v1/jobs", { cookie: owner });
      check("gate 403: an OWNER is not on the cleaner (crew) allow-list", o.status === 403 && o.body?.error?.code === "ROLE_NOT_ALLOWED", o.body);
      const ownerMe = await call("GET", HOST_A, "/api/v1/me", { cookie: owner });
      check("me: an OWNER reads /me, to pick the office side", ownerMe.status === 200 && ownerMe.body?.person?.role === "OWNER", ownerMe.body);
    }
    {
      const mc = await signIn(HOST_A, F.users.mustChange.email);
      const r = await call("GET", HOST_A, "/api/v1/today", { cookie: mc });
      check("gate 403: PASSWORD_CHANGE_REQUIRED", r.status === 403 && r.body?.error?.code === "PASSWORD_CHANGE_REQUIRED", r.body);
      const me = await call("GET", HOST_A, "/api/v1/me", { cookie: mc });
      check("gate: /me answers during a pending change", me.status === 200 && me.body?.mustChangePassword === true, me.body);
      const change = await call("POST", HOST_A, "/api/v1/me/password", {
        cookie: mc,
        body: { currentPassword: PASSWORD, newPassword: "A-Brand-New-Pass-99" },
      });
      check("me/password: allowed during a pending change, and clears it", change.status === 200 && change.body?.ok === true, change.body);
      const after = await call("GET", HOST_A, "/api/v1/today", { cookie: mc });
      check("me/password: the staff routes open afterwards", after.status === 200, after.body);
    }
    {
      const ia = await signIn(HOST_A, F.users.inactive.email);
      // Switched off by a write that did not end their sessions (a row from
      // before revocation existed): the wrapper's fresh read catches it.
      await db.user.update({ where: { id: F.users.inactive.id }, data: { isActive: false } });
      const r = await call("GET", HOST_A, "/api/v1/today", { cookie: ia });
      check("gate 403: ACCOUNT_INACTIVE", r.status === 403 && r.body?.error?.code === "ACCOUNT_INACTIVE", r.body);
      await db.user.update({ where: { id: F.users.inactive.id }, data: { deletedAt: new Date(), isActive: true } });
      const d = await call("GET", HOST_A, "/api/v1/today", { cookie: ia });
      check("gate 403: a deleted person is ACCOUNT_INACTIVE too", d.status === 403 && d.body?.error?.code === "ACCOUNT_INACTIVE", d.body);
    }

    // ── Me and devices ────────────────────────────────────────────────────
    {
      const r = await call("GET", HOST_A, "/api/v1/me", { cookie });
      check(
        "me: person and company",
        r.status === 200 &&
          r.body?.person?.id === F.users.cleaner.id &&
          r.body?.company?.id === F.orgA.id &&
          r.body?.company?.timezone === "America/Toronto" &&
          typeof r.body?.company?.currency === "string" &&
          r.body?.mustChangePassword === false,
        r.body,
      );
    }
    {
      const token = `ExponentPushToken[${randomUUID()}]`;
      const reg = await call("POST", HOST_A, "/api/v1/devices", {
        cookie,
        body: { token, platform: "ios", appVersion: "1.0.0 (1)" },
      });
      check("devices: register", reg.status === 200 && typeof reg.body?.id === "string", reg.body);
      const teammate = await signIn(HOST_A, F.users.teammate.email);
      const again = await call("POST", HOST_A, "/api/v1/devices", {
        cookie: teammate,
        body: { token, platform: "ios", appVersion: "1.0.0 (1)" },
      });
      const row = await db.pushDevice.findFirst({ where: { token } });
      check("devices: the same phone moves to its newest person", again.status === 200 && row?.userId === F.users.teammate.id, row);
      const notMine = await call("POST", HOST_A, "/api/v1/devices/unregister", { cookie, body: { token } });
      const still = await db.pushDevice.count({ where: { token } });
      check("devices: unregistering someone else's token removes nothing", notMine.status === 200 && still === 1);
      const mine = await call("POST", HOST_A, "/api/v1/devices/unregister", { cookie: teammate, body: { token } });
      const gone = await db.pushDevice.count({ where: { token } });
      check("devices: unregistering your own token removes it", mine.status === 200 && gone === 0);
      check("devices: stored in the caller's company", row?.organizationId === F.orgA.id);
    }

    // ── Jobs ──────────────────────────────────────────────────────────────
    {
      const r = await call("GET", HOST_A, "/api/v1/jobs?scope=upcoming", { cookie });
      const ids = (r.body?.items ?? []).map((j: { id: string }) => j.id);
      check(
        "jobs: upcoming lists the cleaner's jobs and no one else's",
        r.status === 200 &&
          ids.includes(F.jobs.mine) &&
          ids.includes(F.jobs.mineTomorrow) &&
          !ids.includes(F.jobs.teammates) &&
          !ids.includes(F.jobs.otherCompany),
        r.body,
      );
      const def = await call("GET", HOST_A, "/api/v1/jobs", { cookie });
      check("jobs: no scope means upcoming, as before", def.status === 200 && def.text === r.text);
      const first = r.body?.items?.find((j: { id: string }) => j.id === F.jobs.mine);
      check(
        "jobs: a summary carries address, service, pay and this cleaner's clock",
        !!first && first.address.line1.includes("Test Street") && first.service.label.length > 0 && first.clock.state === "NOT_STARTED",
        first,
      );
      const past = await call("GET", HOST_A, "/api/v1/jobs?scope=past", { cookie });
      check("jobs: past answers", past.status === 200 && Array.isArray(past.body?.items), past.body);
      const badCursor = await call("GET", HOST_A, "/api/v1/jobs?scope=upcoming&cursor=not-a-cursor", { cookie });
      check("jobs: a forged cursor is 400", badCursor.status === 400, badCursor.body);
      const today = new Date().toISOString().slice(0, 10);
      const in3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const range = await call("GET", HOST_A, `/api/v1/jobs?from=${today}&to=${in3}`, { cookie });
      const rids = (range.body?.items ?? []).map((j: { id: string }) => j.id);
      check("calendar: from/to lists the cleaner's jobs in the span", range.status === 200 && rids.includes(F.jobs.mineTomorrow) && !rids.includes(F.jobs.teammates), range.body);
      const long = await call("GET", HOST_A, `/api/v1/jobs?from=2026-01-01&to=2026-06-01`, { cookie });
      check("calendar: more than 62 days is 400", long.status === 400, long.body);
      const both = await call("GET", HOST_A, `/api/v1/jobs?scope=upcoming&from=${today}&to=${in3}`, { cookie });
      check("calendar: scope and from/to together is 400", both.status === 400, both.body);
      const half = await call("GET", HOST_A, `/api/v1/jobs?from=${today}`, { cookie });
      check("calendar: from without to is 400", half.status === 400, half.body);
    }
    {
      const r = await call("GET", HOST_A, job(F.jobs.mine), { cookie });
      check(
        "job: the cleaner's own job, with crew, checklist counts and a first name",
        r.status === 200 &&
          r.body?.id === F.jobs.mine &&
          r.body?.client?.firstName === "Prem" &&
          r.body?.crew?.some((c: { id: string; isLead: boolean }) => c.id === F.users.cleaner.id && c.isLead) &&
          r.body?.plannedMinutes === 180,
        r.body,
      );
      check("job: billing text is stripped from the notes", !String(r.body?.notes ?? "").includes("$120"), r.body?.notes);
      const t = await call("GET", HOST_A, job(F.jobs.teammates), { cookie });
      check("job 404: a teammate's job in the same company", t.status === 404 && t.body?.error?.code === "NOT_FOUND", t.body);
      const o = await call("GET", HOST_A, job(F.jobs.otherCompany), { cookie });
      check("job 404: another company's job", o.status === 404, o.body);
      const junk = await call("GET", HOST_A, job("../../me"), { cookie });
      check("job 404: a malformed id", junk.status === 404, junk.body);
      const today = await call("GET", HOST_A, "/api/v1/today", { cookie });
      check(
        "today: the next job is the cleaner's own",
        today.status === 200 && [F.jobs.offline, F.jobs.mine, F.jobs.late].includes(today.body?.nextJob?.id),
        today.body,
      );
      check("today: the week and unread counts are numbers", typeof today.body?.week?.hours === "number" && typeof today.body?.unread?.office === "number", today.body);
    }

    // ── Checklist ─────────────────────────────────────────────────────────
    {
      const list = await call("GET", HOST_A, `${job(F.jobs.mine)}/checklist`, { cookie });
      check("checklist: lists the cleaner's items", list.status === 200 && Array.isArray(list.body?.items) && list.body.items.length > 0, list.body);
      const itemId: string = list.body?.items?.[0]?.id ?? F.checklistItem;
      const e = randomUUID();
      const tick = await call("PUT", HOST_A, `${job(F.jobs.mine)}/checklist/${itemId}`, {
        cookie,
        body: { done: true, clientEventId: e },
        headers: { "Idempotency-Key": e },
      });
      check("checklist: tick an item", tick.status === 200 && tick.body?.done === true && tick.body?.id === itemId, tick.body);
      const replay = await call("PUT", HOST_A, `${job(F.jobs.mine)}/checklist/${itemId}`, {
        cookie,
        body: { done: true, clientEventId: e },
        headers: { "Idempotency-Key": e },
      });
      check("checklist: a retry is replayed, not re-applied", replay.status === 200 && replay.headers["idempotent-replayed"] === "true", replay.headers);
      const e2 = randomUUID();
      const other = await call("PUT", HOST_A, `${job(F.jobs.mine)}/checklist/${F.otherChecklistItem}`, {
        cookie,
        body: { done: true, clientEventId: e2 },
        headers: { "Idempotency-Key": e2 },
      });
      check("checklist 404: an item from another job, through this job's path", other.status === 404, other.body);
      const e3 = randomUUID();
      const theirs = await call("PUT", HOST_A, `${job(F.jobs.teammates)}/checklist/${F.otherChecklistItem}`, {
        cookie,
        body: { done: true, clientEventId: e3 },
        headers: { "Idempotency-Key": e3 },
      });
      check("checklist 404: an item on a job the cleaner isn't on", theirs.status === 404, theirs.body);
      const untouched = await db.jobChecklistItem.findUnique({ where: { id: F.otherChecklistItem }, select: { status: true } });
      check("checklist: the teammate's item was not changed", untouched?.status === "PENDING", untouched);
    }

    // ── Clock: the ordinary shift ─────────────────────────────────────────
    {
      const state = await call("GET", HOST_A, `${job(F.jobs.mine)}/clock`, { cookie });
      check("clock: not started", state.status === 200 && state.body?.state === "NOT_STARTED" && state.body?.pendingReview === false, state.body);
      const kit = await call("GET", HOST_A, `${job(F.jobs.mine)}/kit-report`, { cookie });
      check("kit-report: answers", kit.status === 200 && Array.isArray(kit.body?.items), kit.body);
      const notMine = await call("GET", HOST_A, `${job(F.jobs.teammates)}/clock`, { cookie });
      check("clock 404: a job the cleaner isn't on", notMine.status === 404, notMine.body);

      const e = event(2_000);
      const inRes = await post(HOST_A, `${job(F.jobs.mine)}/clock-in`, cookie, e);
      check("clock-in: clocked in", inRes.status === 200 && inRes.body?.state === "CLOCKED_IN" && inRes.body?.pendingReview === false, inRes.body);
      const session = await db.jobWorkSession.findFirst({ where: { jobId: F.jobs.mine, cleanerId: F.users.cleaner.id } });
      check("clock-in: a small gap is applied at the phone's time", near(session?.startedAt, e.occurredAt, 50), session);
      check("clock-in: the event id and arrival are recorded", session?.clientEventId === e.clientEventId && !!session?.receivedAt, session);

      const replay = await post(HOST_A, `${job(F.jobs.mine)}/clock-in`, cookie, e);
      check("idempotency: a retry returns the stored answer", replay.status === 200 && replay.headers["idempotent-replayed"] === "true" && replay.body?.state === "CLOCKED_IN", replay.headers);
      const reused = await post(HOST_A, `${job(F.jobs.mine)}/clock-in`, cookie, { ...e, occurredAt: iso(60_000) });
      check("gate 422: the same key with a different body", reused.status === 422 && reused.body?.error?.code === "IDEMPOTENCY_KEY_REUSED", reused.body);
      const second = await post(HOST_A, `${job(F.jobs.mine)}/clock-in`, cookie, event());
      check("clock-in: a second tap answers with the state the first made", second.status === 200 && second.body?.state === "CLOCKED_IN", second.body);
      const sessions = await db.jobWorkSession.count({ where: { jobId: F.jobs.mine, cleanerId: F.users.cleaner.id } });
      check("clock-in: still exactly one session", sessions === 1, sessions);

      // Another person's key is their own.
      const teammate = await signIn(HOST_A, F.users.teammate.email);
      const theirs = await post(HOST_A, `${job(F.jobs.teammates)}/clock-in`, teammate, { ...event(), clientEventId: e.clientEventId });
      check("idempotency: another person's same key is not a replay of this one", theirs.status === 200 && theirs.headers["idempotent-replayed"] === undefined && theirs.body?.jobId === F.jobs.teammates, theirs.body);
      const b = await signIn(HOST_B, F.users.bCleaner.email);
      const bRes = await post(HOST_B, `${job(F.jobs.otherCompany)}/clock-in`, b, { ...event(), clientEventId: e.clientEventId });
      check("idempotency: another company's same key is its own", bRes.status === 200 && bRes.body?.jobId === F.jobs.otherCompany, bRes.body);
      const cross = await post(HOST_A, `${job(F.jobs.otherCompany)}/clock-in`, cookie, event());
      check("clock-in 404: another company's job id on this company's address", cross.status === 404, cross.body);

      // In flight.
      const k = randomUUID();
      await db.idempotencyRecord.create({
        data: {
          organizationId: F.orgA.id,
          userId: F.users.cleaner.id,
          key: k,
          route: "test",
          requestHash: "x",
          state: "IN_FLIGHT",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const inflight = await post(HOST_A, `${job(F.jobs.mine)}/breaks`, cookie, { ...event(), clientEventId: k });
      check("gate 422/409: a key still in flight with another body is 422", inflight.status === 422, inflight.body);

      const br = await post(HOST_A, `${job(F.jobs.mine)}/breaks`, cookie, event());
      check("break: on break", br.status === 200 && br.body?.state === "ON_BREAK" && br.body?.breaks?.length === 1, br.body);
      const br2 = await post(HOST_A, `${job(F.jobs.mine)}/breaks`, cookie, event());
      check("break: a second start answers with the break already running", br2.status === 200 && br2.body?.state === "ON_BREAK" && br2.body?.breaks?.length === 1, br2.body);
      const end = await post(HOST_A, `${job(F.jobs.mine)}/breaks/current/end`, cookie, event());
      check("break: ended", end.status === 200 && end.body?.state === "CLOCKED_IN" && end.body?.breaks?.[0]?.endedAt, end.body);
      const end2 = await post(HOST_A, `${job(F.jobs.mine)}/breaks/current/end`, cookie, event());
      check("break: ending again is the same state", end2.status === 200 && end2.body?.state === "CLOCKED_IN", end2.body);

      const out = await post(HOST_A, `${job(F.jobs.mine)}/clock-out`, cookie, { ...event(), report: { items: [] } });
      check("clock-out: clocked out, and the job is done", out.status === 200 && out.body?.clock?.state === "CLOCKED_OUT" && out.body?.jobCompleted === true, out.body);
      const jobRow = await db.job.findUnique({ where: { id: F.jobs.mine }, select: { status: true } });
      check("clock-out: the job is COMPLETED, as on the web", jobRow?.status === "COMPLETED", jobRow);
      const out2 = await post(HOST_A, `${job(F.jobs.mine)}/clock-out`, cookie, { ...event(), report: { items: [] } });
      check("clock-out: a second tap answers with the state the first made", out2.status === 200 && out2.body?.clock?.state === "CLOCKED_OUT", out2.body);
    }

    // In-flight with the same body, on a fresh key.
    {
      const e = event();
      const { requestHash } = await import("../src/server/v1/request-hash");
      await db.idempotencyRecord.create({
        data: {
          organizationId: F.orgA.id,
          userId: F.users.cleaner.id,
          key: e.clientEventId,
          route: "x",
          requestHash: requestHash("POST", `${job(F.jobs.offline)}/breaks`, e),
          state: "IN_FLIGHT",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const r = await post(HOST_A, `${job(F.jobs.offline)}/breaks`, cookie, e);
      check("gate 409: a key still in flight", r.status === 409 && r.body?.error?.code === "IN_FLIGHT" && r.body?.error?.retryable === true, r.body);
    }

    // ── Clock: offline rules (API_V1.md §6) ───────────────────────────────
    // A phone that really was offline made no request between its tap and
    // this one. Staging answers slowly enough that this test's own earlier
    // requests would otherwise (correctly) disprove the claim.
    const wentOffline = async (msAgo: number) => {
      await db.session.updateMany({
        where: { userId: F.users.cleaner.id },
        data: { lastRequestAt: new Date(Date.now() - msAgo) },
      });
    };
    {
      await wentOffline(10 * 60_000);
      const e = event(3 * 60_000);
      const r = await post(HOST_A, `${job(F.jobs.offline)}/clock-in`, cookie, e);
      const s = await db.jobWorkSession.findFirst({ where: { jobId: F.jobs.offline, cleanerId: F.users.cleaner.id } });
      check("offline: a 3-minute gap is applied at the phone's time", r.status === 200 && near(s?.startedAt, e.occurredAt, 50) && r.body?.pendingReview === false, { r: r.body, s });

      // Online well after the tap and before this request: disproved.
      const sess = await db.session.findMany({ where: { userId: F.users.cleaner.id }, select: { id: true } });
      await db.session.updateMany({ where: { id: { in: sess.map((x) => x.id) } }, data: { lastRequestAt: new Date(Date.now() - 60_000) } });
      const b = event(2 * 60_000);
      const br = await post(HOST_A, `${job(F.jobs.offline)}/breaks`, cookie, b);
      const brk = await db.jobBreak.findFirst({ where: { jobId: F.jobs.offline, cleanerId: F.users.cleaner.id } });
      const req = await db.timeLogChangeRequest.findFirst({ where: { clientEventId: b.clientEventId } });
      check("offline: a claim disproved by a later request is applied at arrival", br.status === 200 && !near(brk?.startedAt, b.occurredAt, 30_000), brk);
      check(
        "offline: ...and the phone's time goes to the office",
        req?.source === "OFFLINE_CLOCK" && req.eventKind === "BREAK_START" && req.offlineReason === "NOT_PROVEN_OFFLINE" && req.breakId === brk?.id && near(req.requestedStart, b.occurredAt, 50) && req.status === "PENDING",
        req,
      );
      check("offline: the clock says it is waiting on the office", br.body?.pendingReview === true, br.body);
      const end = await post(HOST_A, `${job(F.jobs.offline)}/breaks/current/end`, cookie, event());
      check("offline: the break ends normally", end.status === 200 && end.body?.state === "CLOCKED_IN", end.body);
      const out = await post(HOST_A, `${job(F.jobs.offline)}/clock-out`, cookie, {
        ...event(),
        report: { items: [{ productId: "not-in-kit", kind: "COUNT", quantity: 3 }] },
      });
      check("offline: a kit line that no longer fits doesn't refuse the clock-out", out.status === 200 && out.body?.clock?.state === "CLOCKED_OUT", out.body);
      const flagged = await db.jobLog.count({ where: { jobId: F.jobs.offline, field: "CLOSING_REPORT_LINES_SKIPPED" } });
      check("offline: ...it is written down for the office instead", flagged === 1, flagged);
    }
    {
      // Too late: 20 minutes offline, applied at arrival, sent for approval.
      await wentOffline(30 * 60_000);
      const e = event(20 * 60_000);
      const r = await post(HOST_A, `${job(F.jobs.late)}/clock-in`, cookie, e);
      const s = await db.jobWorkSession.findFirst({ where: { jobId: F.jobs.late, clientEventId: e.clientEventId } });
      const req = await db.timeLogChangeRequest.findFirst({ where: { clientEventId: e.clientEventId } });
      check(
        "offline: a 20-minute gap is applied at arrival",
        r.status === 200 && !!s && !!s.receivedAt && near(s.startedAt, s.receivedAt, 1_000) && !near(s.startedAt, e.occurredAt, 5 * 60_000),
        { r: r.body, s },
      );
      check(
        "offline: ...with a correction request carrying the phone's time for that session",
        req?.source === "OFFLINE_CLOCK" &&
          req.eventKind === "CLOCK_IN" &&
          req.offlineReason === "GAP_OVER_LIMIT" &&
          req.sessionId === s?.id &&
          near(req.requestedStart, e.occurredAt, 50) &&
          req.requestedEnd === null &&
          /no signal/.test(req.reason) &&
          near(req.receivedAt, s?.receivedAt ?? new Date(0), 1_000),
        req,
      );
      check("offline: pendingReview is true", r.body?.pendingReview === true, r.body);
      const again = await post(HOST_A, `${job(F.jobs.late)}/clock-in`, cookie, e);
      const count = await db.timeLogChangeRequest.count({ where: { clientEventId: e.clientEventId } });
      check("offline: a retry raises no second request", again.headers["idempotent-replayed"] === "true" && count === 1, { count });
      const strike = await db.cleanerStrike.count({ where: { cleanerId: F.users.cleaner.id, jobId: F.jobs.late } });
      check("offline: lateness is judged at the applied (arrival) time, as §6 says", strike === 1, strike);
    }
    {
      // A clock-out with no clock-in is kept for the office, not dropped.
      const e = event(60_000);
      const r = await post(HOST_A, `${job(F.jobs.mineTomorrow)}/clock-out`, cookie, { ...e, report: { items: [] } });
      const req = await db.timeLogChangeRequest.findFirst({ where: { clientEventId: e.clientEventId } });
      check("never lost: a clock-out with no clock-in becomes a correction request", r.status === 200 && r.body?.clock?.pendingReview === true && req?.eventKind === "CLOCK_OUT" && req.offlineReason === "COULD_NOT_APPLY" && req.sessionId === null, { r: r.body, req });
      const future = event(-10 * 60_000);
      const early = await post(HOST_A, `${job(F.jobs.mineTomorrow)}/clock-in`, cookie, future);
      check("clock-in: a job 26 hours away is too early (409), as on the web", early.status === 409 && early.body?.error?.code === "TOO_EARLY", early.body);
    }

    // ── Areas, one file each ──────────────────────────────────────────────
    await runTalkChecks({ db, F, HOST_A, HOST_B, call, check, signIn: (h, e) => signIn(h, e) });
    await mediaChecks({ db, F, host: HOST_A, slugA: SLUG_A, call, check, signIn: (h, e) => signIn(h, e) });

    // ── Password change ends the other sessions ───────────────────────────
    {
      const other = await signIn(HOST_A, F.users.cleaner.email);
      const wrong = await call("POST", HOST_A, "/api/v1/me/password", {
        cookie,
        body: { currentPassword: "wrong-password", newPassword: "Another-Pass-2026" },
      });
      check("me/password: a wrong current password is refused", wrong.status === 400 && wrong.body?.error?.code === "WRONG_PASSWORD", wrong.body);
      const ok = await call("POST", HOST_A, "/api/v1/me/password", {
        cookie,
        body: { currentPassword: PASSWORD, newPassword: "Another-Pass-2026" },
      });
      check("me/password: changed", ok.status === 200, ok.body);
      const mine = await call("GET", HOST_A, "/api/v1/me", { cookie });
      const theirs = await call("GET", HOST_A, "/api/v1/me", { cookie: other });
      check("me/password: this device stays signed in", mine.status === 200, mine.body);
      check("me/password: every other session ends", theirs.status === 401, theirs.body);
    }

    // ── Record: training, documents, strikes (./api-v1/record.ts) ─────────
    await recordChecks({ db, fx: F, hostA: HOST_A, hostB: HOST_B, cookie, call, check, signIn });
  } finally {
    if (fx && !KEEP) {
      await removeFixture(db).catch((e) => console.error("cleanup failed:", e));
      const left = await db.organization.count({ where: { slug: { in: [SLUG_A, SLUG_B] } } });
      console.log(left === 0 ? "cleanup: both test companies removed" : `cleanup: ${left} left behind`);
    }
    await db.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed (${retries} requests retried after a 5xx)`);
  if (fail) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("RUN FAILED:", e);
  process.exitCode = 1;
});
