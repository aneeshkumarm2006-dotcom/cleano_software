/**
 * API v1 integration checks for the MONEY area: available jobs (the board,
 * the preview, the claim) and pay (summary, payouts, withdrawals, a period,
 * one job's pay, and the withdrawal request), against a running server
 * connected to STAGING.
 *
 *   # 1. a local server on :3100 whose DATABASE_URL is the staging app role
 *   # 2. then:
 *   FIXTURE_DATABASE_URL="$STAGING_DIRECT_URL" npx tsx scripts/api-v1/money.ts
 *
 * It builds the shared fixture (./fixture.ts: two throwaway companies, .test
 * emails, "Prem Sai" jobs), adds its own open jobs, payouts and people to the
 * test company, runs every check, and deletes both companies at the end, pass
 * or fail (--keep leaves them). Run it on its own, not at the same time as
 * scripts/api-v1-integration.ts: both use the same two test companies.
 *
 * Covers each endpoint's happy path, not-yours → 404, wrong role → 403,
 * validation → 400, idempotent replay, and the special rules of
 * packages/api/src/v1/available.ts and pay.ts, including two CONCURRENCY
 * checks: cleaners racing for the last spot(s) on a job (exactly the free
 * spots are taken), and one person's withdrawals sent at once (the balance is
 * never overdrawn).
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { createFixture, openDb, PASSWORD, removeFixture, SLUG_A, SLUG_B, type Fixture } from "./fixture";

const PORT = Number(process.env.V1_PORT ?? 3100);
const APEX = `localhost:${PORT}`;
const HOST_A = `${SLUG_A}.localhost:${PORT}`;
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
    console.log(`FAIL  ${name}${detail === undefined ? "" : `\n        ${JSON.stringify(detail).slice(0, 700)}`}`);
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
 * One request, retried on a 5xx up to three times (staging's pooler drops
 * connections now and then; a 500 frees the idempotency key, so a retry is
 * safe). Every retry is counted in the summary. Concurrency checks call
 * callOnce: a retry there would hide what the race did.
 */
async function call(
  method: string,
  host: string,
  path: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
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
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res> {
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const headers: Record<string, string> = {
    Host: host,
    Accept: "application/json",
    "X-App-Version": "1.0.0 (1)",
    "X-App-Platform": "ios",
    ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    ...opts.headers,
  };
  // An empty value means "leave this header off" (sign-in isn't a v1 route).
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

async function signIn(host: string, email: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await callOnce("POST", host, "/api/auth/sign-in/email", {
      body: { email, password: PASSWORD },
      headers: { "X-App-Version": "", "X-App-Platform": "", "expo-origin": "bookmopspro://" },
    });
    const set = res.headers["set-cookie"] ?? [];
    for (const c of set) {
      const m = /^((?:__Secure-)?better-auth\.session_token)=([^;]+)/.exec(c);
      if (m) return `${m[1]}=${m[2]}`;
    }
    // better-auth limits sign-in per address; a burst of test sign-ins waits it out.
    if (res.status === 429 && attempt < 8) {
      await new Promise((r) => setTimeout(r, 11_000));
      continue;
    }
    if (res.status < 500 || attempt >= 4) throw new Error(`sign-in ${email} failed: ${res.status} ${res.text.slice(0, 200)}`);
    retries++;
    await new Promise((r) => setTimeout(r, 3_000 * attempt));
  }
}

const get = (path: string, cookie: string) => call("GET", HOST_A, path, { cookie });
const post = (path: string, cookie: string, body: Record<string, unknown>, key?: string) =>
  call("POST", HOST_A, path, {
    cookie,
    body,
    headers: { "Idempotency-Key": key ?? (body.clientEventId as string) },
  });
const postOnce = (path: string, cookie: string, body: Record<string, unknown>) =>
  callOnce("POST", HOST_A, path, { cookie, body, headers: { "Idempotency-Key": body.clientEventId as string } });

/** The same JSON, whatever the key order (a stored answer comes back out of jsonb). */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]))
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

const claimPath = (id: string) => `/api/v1/jobs/available/${id}/claim`;
const claim = (id: string, cookie: string, key = randomUUID()) => post(claimPath(id), cookie, { clientEventId: key });
const withdraw = (cookie: string, amountCents: number, extra: Record<string, unknown> = {}) =>
  post("/api/v1/pay/withdrawals", cookie, {
    amountCents,
    expectedFeeBasisPoints: 500,
    clientEventId: randomUUID(),
    ...extra,
  });

// ── Extra test rows, all inside the fixture's company A ─────────────────────

interface MoneyRows {
  people: Record<"restricted" | "trainee" | "x1" | "x2" | "x3" | "x4" | "x5", { id: string; email: string }>;
  jobs: Record<
    | "open"
    | "far"
    | "saturday"
    | "race"
    | "race2"
    | "held"
    | "started"
    | "full"
    | "quote"
    | "commercial"
    | "residentialLate"
    | "otherCompanyOpen"
    | "completed",
    string
  >;
  payouts: { paid: string; draft: string; otherCompany: string };
}

/** The next Saturday, at noon in Toronto (the fixture company's zone), at least 3 days out. */
function nextSaturdayNoon(): Date {
  const d = new Date();
  for (let i = 3; i < 11; i++) {
    const t = new Date(d.getTime() + i * 86_400_000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short" }).format(t);
    if (wd === "Sat") {
      const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(t);
      // Noon Toronto is 16:00 or 17:00 UTC; 16:30 UTC is noon-ish either way and safely Saturday.
      return new Date(`${ymd}T16:30:00Z`);
    }
  }
  throw new Error("no Saturday found");
}

/** A weekday 10–13 days out (outside `week`, not a weekend). */
function farWeekday(): Date {
  for (let i = 10; i < 14; i++) {
    const t = new Date(Date.now() + i * 86_400_000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short" }).format(t);
    if (wd !== "Sat" && wd !== "Sun") {
      const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(t);
      return new Date(`${ymd}T15:00:00Z`);
    }
  }
  throw new Error("no weekday found");
}

async function addMoneyRows(db: PrismaClient, fx: Fixture): Promise<MoneyRows> {
  const orgA = fx.orgA.id;
  const hashed = await hashPassword(PASSWORD);

  async function person(local: string, extra: { cleanerTier?: "TRAINEE" | "STANDARD"; allowed?: string[] } = {}) {
    const email = `${local}@${SLUG_A}.test`;
    const u = await db.user.create({
      data: {
        organizationId: orgA,
        name: `${local[0].toUpperCase()}${local.slice(1)} Tester`,
        email,
        role: "EMPLOYEE",
        emailVerified: true,
        isActive: true,
        cleanerTier: extra.cleanerTier ?? "STANDARD",
        allowedServiceCategories: extra.allowed ?? [],
      },
      select: { id: true, email: true },
    });
    await db.account.create({ data: { userId: u.id, accountId: u.id, providerId: "credential", password: hashed } });
    return u;
  }

  const people = {
    restricted: await person("restricted", { allowed: ["RESIDENTIAL"] }),
    trainee: await person("trainee", { cleanerTier: "TRAINEE" }),
    x1: await person("xone"),
    x2: await person("xtwo"),
    x3: await person("xthree"),
    x4: await person("xfour"),
    x5: await person("xfive"),
  };

  let n = 9500;
  async function openJob(
    organizationId: string,
    start: Date,
    label: string,
    extra: Partial<{
      requiredCleaners: number;
      status: "SCHEDULED" | "CREATED" | "COMPLETED";
      holdReason: string | null;
      quoteStatus: "QUOTED" | "PENDING_REVIEW" | null;
      jobType: string;
      crew: string[];
      lead: string | null;
    }> = {},
  ) {
    const crew = extra.crew ?? [];
    const j = await db.job.create({
      data: {
        organizationId,
        jobNumber: n++,
        clientName: `Prem Sai ${label}`,
        employeeId: extra.lead ?? null,
        jobType: extra.jobType ?? "Standard Clean",
        location: `${n} Rue Secretstreet, Le Plateau, QC H2X 1Y4`,
        startTime: start,
        endTime: new Date(start.getTime() + 3 * 3600_000),
        jobDate: start,
        status: extra.status ?? "SCHEDULED",
        holdReason: extra.holdReason ?? null,
        quoteStatus: extra.quoteStatus ?? null,
        price: 200,
        subtotalAmount: 200,
        payType: "PERCENTAGE",
        requiredCleaners: extra.requiredCleaners ?? 1,
        notes: "Buzz 1234. Total $200 billed to card.",
        cleaners: { connect: crew.map((id) => ({ id })) },
      },
      select: { id: true },
    });
    for (const id of crew) await db.jobAssignment.create({ data: { organizationId, jobId: j.id, cleanerId: id } });
    return j.id;
  }

  const h = 3600_000;
  const now = Date.now();
  const jobs = {
    open: await openJob(orgA, new Date(now + 48 * h), "open"),
    far: await openJob(orgA, farWeekday(), "far"),
    saturday: await openJob(orgA, nextSaturdayNoon(), "saturday"),
    race: await openJob(orgA, new Date(now + 50 * h), "race"),
    race2: await openJob(orgA, new Date(now + 52 * h), "race2", { requiredCleaners: 2 }),
    held: await openJob(orgA, new Date(now + 54 * h), "held", { status: "CREATED", holdReason: "Awaiting price" }),
    started: await openJob(orgA, new Date(now - 10 * 60_000), "started"),
    full: await openJob(orgA, new Date(now + 56 * h), "full", { crew: [fx.users.teammate.id], lead: fx.users.teammate.id }),
    quote: await openJob(orgA, new Date(now + 58 * h), "quote", { status: "CREATED", quoteStatus: "QUOTED" }),
    commercial: "",
    residentialLate: "",
    otherCompanyOpen: await openJob(fx.orgB.id, new Date(now + 48 * h), "b-open"),
    completed: await openJob(orgA, new Date(now - 5 * 24 * h), "done", {
      status: "COMPLETED",
      crew: [fx.users.cleaner.id],
      lead: fx.users.cleaner.id,
    }),
  };
  // 25 commercial jobs ahead of one residential job: a cleaner approved only
  // for residential must still get that job on their FIRST page.
  for (let i = 0; i < 25; i++) {
    const id = await openJob(orgA, new Date(now + (60 + i) * h), `c${i}`, { jobType: "Commercial" });
    if (i === 0) jobs.commercial = id;
  }
  jobs.residentialLate = await openJob(orgA, new Date(now + 90 * h), "res-late");

  // Pay: a PAID period of $100 and a legacy negative PAID row (clamped to 0),
  // a DRAFT period (pending), a rejected and a pending withdrawal.
  async function period(organizationId: string, daysAgo: number, status: "PAID" | "DRAFT") {
    const start = new Date(now - daysAgo * 24 * h);
    return db.payPeriod.create({
      data: {
        organizationId,
        startDate: start,
        endDate: new Date(start.getTime() + 7 * 24 * h - 1),
        status,
        paidAt: status === "PAID" ? new Date(start.getTime() + 9 * 24 * h) : null,
      },
      select: { id: true },
    });
  }
  const paidPeriod = await period(orgA, 8, "PAID");
  const legacyPeriod = await period(orgA, 22, "PAID");
  const draftPeriod = await period(orgA, 1, "DRAFT");
  const payout = (organizationId: string, payPeriodId: string, employeeId: string, base: number, deductions = 0) =>
    db.payout.create({
      data: {
        organizationId,
        payPeriodId,
        employeeId,
        baseAmount: base,
        deductions,
        finalAmount: base - deductions,
        jobCount: 1,
        totalHours: 3,
      },
      select: { id: true },
    });
  const paid = await payout(orgA, paidPeriod.id, fx.users.cleaner.id, 100);
  await payout(orgA, legacyPeriod.id, fx.users.cleaner.id, 10, 50);
  const draft = await payout(orgA, draftPeriod.id, fx.users.cleaner.id, 40);
  // x1 and x2 each have $100 paid, for the concurrency checks; x3 $50.
  await payout(orgA, paidPeriod.id, people.x1.id, 100);
  await payout(orgA, paidPeriod.id, people.x2.id, 100);
  await payout(orgA, paidPeriod.id, people.x3.id, 50);
  // The completed job's date sits inside the PAID period.
  await db.job.update({ where: { id: jobs.completed }, data: { jobDate: new Date(now - 5 * 24 * h), startTime: new Date(now - 5 * 24 * h) } });

  await db.withdrawal.create({ data: { organizationId: orgA, employeeId: fx.users.cleaner.id, amount: 30, status: "REJECTED" } });
  await db.withdrawal.create({ data: { organizationId: orgA, employeeId: fx.users.cleaner.id, amount: 10, status: "PENDING" } });

  const bPeriod = await period(fx.orgB.id, 8, "PAID");
  const otherCompany = await payout(fx.orgB.id, bPeriod.id, fx.users.bCleaner.id, 70);

  return { people, jobs, payouts: { paid: paid.id, draft: draft.id, otherCompany: otherCompany.id } };
}

async function main() {
  const db = openDb();
  let fx: Fixture | null = null;
  try {
    const up = await callOnce("GET", APEX, "/api/v1/meta").catch(() => null);
    if (!up) throw new Error(`no server on :${PORT}`);

    fx = await createFixture(db);
    const F = fx;
    const M = await addMoneyRows(db, F);
    console.log(`fixture: ${SLUG_A} ${F.orgA.id}, ${SLUG_B} ${F.orgB.id}`);

    const cleaner = await signIn(HOST_A, F.users.cleaner.email);
    const teammate = await signIn(HOST_A, F.users.teammate.email);
    const applicant = await signIn(HOST_A, F.users.applicant.email);
    const owner = await signIn(HOST_A, F.users.owner.email);

    // ── The board ─────────────────────────────────────────────────────────
    {
      const r = await get("/api/v1/jobs/available", cleaner);
      const ids: string[] = (r.body?.items ?? []).map((j: { id: string }) => j.id);
      check("board: 200 with a page of 20 and a next cursor", r.status === 200 && ids.length === 20 && !!r.body?.nextCursor, { status: r.status, n: ids.length, body: r.body?.error });
      check("board: soonest first", r.status === 200 && r.body.items.every((j: { startsAt: string }, i: number, a: { startsAt: string }[]) => i === 0 || a[i - 1].startsAt <= j.startsAt));
      const first = r.body?.items?.find((j: { id: string }) => j.id === M.jobs.open);
      check("board: an open job is on it", !!first, ids);
      check(
        "board: the area only — no street, no client, no price",
        !!first && first.area === "Le Plateau" && !r.text.includes("Secretstreet") && !r.text.includes("Prem Sai") && !/"price"/.test(r.text),
        first,
      );
      check(
        "board: this cleaner's own estimate, in cents",
        !!first && first.pay.type === "PERCENTAGE" && Number.isInteger(first.pay.estimateCents) && first.pay.estimateCents > 0 && first.pay.hourlyRateCents === null,
        first?.pay,
      );
      check("board: crew counts", !!first && first.crew.required === 1 && first.crew.claimed === 0, first?.crew);
      for (const [label, id] of [
        ["on hold", M.jobs.held],
        ["already started", M.jobs.started],
        ["fully staffed", M.jobs.full],
        ["an unsettled quote", M.jobs.quote],
        ["another company's", M.jobs.otherCompanyOpen],
        ["already mine", F.jobs.mine],
      ] as const) {
        check(`board: never shows a job ${label}`, !ids.includes(id));
      }
      // Page two continues after page one, with no repeats.
      const all = [...ids];
      let cursor: string | null = r.body?.nextCursor ?? null;
      for (let i = 0; i < 5 && cursor; i++) {
        const next = await get(`/api/v1/jobs/available?cursor=${encodeURIComponent(cursor)}`, cleaner);
        all.push(...(next.body?.items ?? []).map((j: { id: string }) => j.id));
        cursor = next.body?.nextCursor ?? null;
      }
      check("board: paging reaches the end with no repeats", new Set(all).size === all.length && all.includes(M.jobs.residentialLate) && cursor === null, all.length);
      const bad = await get("/api/v1/jobs/available?cursor=not-a-cursor", cleaner);
      check("board: a forged cursor is 400", bad.status === 400, bad.body);
      const badWhen = await get("/api/v1/jobs/available?when=someday", cleaner);
      check("board: an unknown `when` is 400", badWhen.status === 400 && badWhen.body?.error?.code === "VALIDATION_FAILED", badWhen.body);
    }
    {
      const week = await get("/api/v1/jobs/available?when=week", cleaner);
      const weekIds: string[] = [];
      let wc: string | null = null;
      let wr = week;
      for (let i = 0; i < 6; i++) {
        weekIds.push(...(wr.body?.items ?? []).map((j: { id: string }) => j.id));
        wc = wr.body?.nextCursor ?? null;
        if (!wc) break;
        wr = await get(`/api/v1/jobs/available?when=week&cursor=${encodeURIComponent(wc)}`, cleaner);
      }
      check("board when=week: today through six days on", week.status === 200 && weekIds.includes(M.jobs.open) && !weekIds.includes(M.jobs.far), weekIds.length);
      const weekend = await get("/api/v1/jobs/available?when=weekend", cleaner);
      const we: string[] = (weekend.body?.items ?? []).map((j: { id: string }) => j.id);
      check("board when=weekend: Saturday and Sunday only", weekend.status === 200 && we.includes(M.jobs.saturday) && !we.includes(M.jobs.far) && !we.includes(M.jobs.open), we);
    }
    {
      const restricted = await signIn(HOST_A, M.people.restricted.email);
      const r = await get("/api/v1/jobs/available", restricted);
      const ids: string[] = (r.body?.items ?? []).map((j: { id: string }) => j.id);
      check("board: a residential-only cleaner never sees commercial work", r.status === 200 && !ids.includes(M.jobs.commercial), ids.length);
      check(
        "board: ...and gets the residential job behind 25 commercial ones on the FIRST page",
        ids.includes(M.jobs.residentialLate),
        ids.length,
      );
      const preview = await get(`/api/v1/jobs/available/${M.jobs.commercial}`, restricted);
      check("preview: a category they may not work is 404", preview.status === 404, preview.body);
      const c = await claim(M.jobs.commercial, restricted);
      check("claim: ...and the claim is 409 CATEGORY_NOT_ALLOWED", c.status === 409 && c.body?.error?.code === "CATEGORY_NOT_ALLOWED" && c.body?.error?.retryable === false, c.body);
    }
    {
      const a = await get("/api/v1/jobs/available", applicant);
      check("board: an APPLICANT is 403", a.status === 403 && a.body?.error?.code === "ROLE_NOT_ALLOWED", a.body);
      const o = await get("/api/v1/jobs/available", owner);
      check("board: an OWNER calling as staff is 403 (staff = EMPLOYEE, FIELD_LEAD)", o.status === 403, o.body);
      const none = await call("GET", HOST_A, "/api/v1/jobs/available");
      check("board: no session is 401", none.status === 401, none.body);
    }

    // ── The preview ───────────────────────────────────────────────────────
    {
      const before = await db.job.findUnique({ where: { id: M.jobs.open }, select: { updatedAt: true, employeeId: true } });
      const checklistsBefore = await db.jobChecklist.count({ where: { jobId: M.jobs.open } });
      const r = await get(`/api/v1/jobs/available/${M.jobs.open}`, cleaner);
      check("preview: 200", r.status === 200 && r.body?.id === M.jobs.open, r.body);
      check(
        "preview: no street, unit, postal code, client or price",
        r.status === 200 && !r.text.includes("Secretstreet") && !r.text.includes("H2X") && !r.text.includes("Prem Sai") && !/"price"/.test(r.text),
        r.text.slice(0, 400),
      );
      check("preview: notes with the billing text stripped", r.status === 200 && !String(r.body.notes ?? "").includes("$200"), r.body?.notes);
      check("preview: planned minutes", r.body?.plannedMinutes === 180, r.body?.plannedMinutes);
      const after = await db.job.findUnique({ where: { id: M.jobs.open }, select: { updatedAt: true, employeeId: true } });
      const checklistsAfter = await db.jobChecklist.count({ where: { jobId: M.jobs.open } });
      check(
        "preview: read-only — nothing about the job changed, no checklist made",
        before?.updatedAt.getTime() === after?.updatedAt.getTime() && after?.employeeId === null && checklistsBefore === checklistsAfter,
        { before, after, checklistsBefore, checklistsAfter },
      );
      for (const [label, id] of [
        ["on hold", M.jobs.held],
        ["already started", M.jobs.started],
        ["fully staffed", M.jobs.full],
        ["an unsettled quote", M.jobs.quote],
        ["in another company", M.jobs.otherCompanyOpen],
        ["already mine", F.jobs.mine],
        ["that doesn't exist", "cnotarealjobid000000000"],
      ] as const) {
        const p = await get(`/api/v1/jobs/available/${id}`, cleaner);
        check(`preview: a job ${label} is 404`, p.status === 404 && p.body?.error?.code === "NOT_FOUND", p.body);
      }
      const bad = await get("/api/v1/jobs/available/bad%20id!", cleaner);
      check("preview: a malformed id is 404", bad.status === 404, bad.body);
      const ap = await get(`/api/v1/jobs/available/${M.jobs.open}`, applicant);
      check("preview: an APPLICANT is 403", ap.status === 403, ap.body);
    }

    // ── The claim ─────────────────────────────────────────────────────────
    {
      const noKey = await call("POST", HOST_A, claimPath(M.jobs.open), { cookie: cleaner, body: { clientEventId: randomUUID() } });
      check("claim: no Idempotency-Key is 400", noKey.status === 400 && noKey.body?.error?.code === "IDEMPOTENCY_KEY_REQUIRED", noKey.body);
      const badBody = await post(claimPath(M.jobs.open), cleaner, { clientEventId: "not-a-uuid" }, "abcdefgh-1234");
      check("claim: a body that isn't the contract is 400", badBody.status === 400, badBody.body);

      const key = randomUUID();
      const r = await claim(M.jobs.open, cleaner, key);
      check("claim: 200 with the job, now mine, full address included", r.status === 200 && r.body?.job?.id === M.jobs.open && /Secretstreet/.test(r.body?.job?.address?.line1 ?? ""), r.body);
      const job = await db.job.findUnique({
        where: { id: M.jobs.open },
        select: { employeeId: true, cleaners: { select: { id: true } } },
      });
      const assignments = await db.jobAssignment.count({ where: { jobId: M.jobs.open, cleanerId: F.users.cleaner.id } });
      const logs = await db.jobLog.count({ where: { jobId: M.jobs.open, field: "cleaners" } });
      check(
        "claim: recorded whole — crew, lead, assignment row and log",
        job?.employeeId === F.users.cleaner.id && job.cleaners.some((c) => c.id === F.users.cleaner.id) && assignments === 1 && logs === 1,
        { job, assignments, logs },
      );
      const again = await claim(M.jobs.open, cleaner, key);
      check(
        "claim: a replay returns the stored answer and claims nothing again",
        again.status === 200 && again.headers["idempotent-replayed"] === "true" && sameJson(again.body, r.body),
        again.status,
      );
      const logsAfter = await db.jobLog.count({ where: { jobId: M.jobs.open, field: "cleaners" } });
      check("claim: ...no second log line", logsAfter === 1, logsAfter);
      const reuse = await claim(M.jobs.race, cleaner, key);
      check("claim: the same key on another job is 422", reuse.status === 422 && reuse.body?.error?.code === "IDEMPOTENCY_KEY_REUSED", reuse.body);
      const twice = await claim(M.jobs.open, cleaner);
      check("claim: a new key on a job already mine is 409 ALREADY_CLAIMED", twice.status === 409 && twice.body?.error?.code === "ALREADY_CLAIMED", twice.body);
      const mine = await get("/api/v1/jobs?scope=upcoming", cleaner);
      check("claim: the job is in My jobs", (mine.body?.items ?? []).some((j: { id: string }) => j.id === M.jobs.open), mine.status);
    }
    for (const [label, id, code, status] of [
      ["on hold", M.jobs.held, "ON_HOLD", 409],
      ["already started", M.jobs.started, "ALREADY_STARTED", 409],
      ["fully staffed", M.jobs.full, "FULLY_STAFFED", 409],
      ["an unsettled quote", M.jobs.quote, "NOT_AVAILABLE", 409],
      ["in another company", M.jobs.otherCompanyOpen, "NOT_FOUND", 404],
      ["that doesn't exist", "cnotarealjobid000000000", "NOT_FOUND", 404],
    ] as const) {
      const r = await claim(id, cleaner);
      check(`claim: a job ${label} is ${status} ${code}`, r.status === status && r.body?.error?.code === code && r.body?.error?.retryable === false, r.body);
    }
    {
      const trainee = await signIn(HOST_A, M.people.trainee.email);
      const r = await claim(M.jobs.far, trainee);
      check("claim: a TRAINEE on a job with nobody approved is 409 TRAINEE_NEEDS_CREW", r.status === 409 && r.body?.error?.code === "TRAINEE_NEEDS_CREW", r.body);
      const ap = await claim(M.jobs.far, applicant);
      check("claim: an APPLICANT is 403, and nothing is written", ap.status === 403, ap.body);
      const own = await claim(M.jobs.far, owner);
      check("claim: an OWNER calling as staff is 403", own.status === 403, own.body);
      const far = await db.job.findUnique({ where: { id: M.jobs.far }, select: { cleaners: { select: { id: true } } } });
      check("claim: ...the job is still open", far?.cleaners.length === 0, far);
    }

    // ── Concurrency: the last spot ────────────────────────────────────────
    {
      // Two cleaners, one spot, sent together.
      const [a, b] = await Promise.all([
        postOnce(claimPath(M.jobs.race), cleaner, { clientEventId: randomUUID() }),
        postOnce(claimPath(M.jobs.race), teammate, { clientEventId: randomUUID() }),
      ]);
      const statuses = [a.status, b.status].sort();
      const loser = a.status === 200 ? b : a;
      check(
        "race: two cleaners, one spot — exactly one wins, the other is 409 FULLY_STAFFED",
        statuses[0] === 200 && statuses[1] === 409 && loser.body?.error?.code === "FULLY_STAFFED",
        { a: [a.status, a.body?.error?.code], b: [b.status, b.body?.error?.code] },
      );
      const job = await db.job.findUnique({ where: { id: M.jobs.race }, select: { employeeId: true, cleaners: { select: { id: true } } } });
      const rows = await db.jobAssignment.count({ where: { jobId: M.jobs.race } });
      check("race: ...the crew is one person, with one assignment row", job?.cleaners.length === 1 && rows === 1 && job.employeeId === job.cleaners[0].id, { job, rows });
    }
    {
      // Four cleaners, two spots, sent together.
      const people = [M.people.x1, M.people.x2, M.people.x3, M.people.x4];
      const cookies: string[] = [];
      for (const p of people) cookies.push(await signIn(HOST_A, p.email));
      const results = await Promise.all(cookies.map((c) => postOnce(claimPath(M.jobs.race2), c, { clientEventId: randomUUID() })));
      const won = results.filter((r) => r.status === 200).length;
      const full = results.filter((r) => r.status === 409 && r.body?.error?.code === "FULLY_STAFFED").length;
      check("race: four cleaners, two spots — exactly two win, two are FULLY_STAFFED", won === 2 && full === 2, results.map((r) => [r.status, r.body?.error?.code]));
      const job = await db.job.findUnique({ where: { id: M.jobs.race2 }, select: { employeeId: true, cleaners: { select: { id: true } } } });
      const rows = await db.jobAssignment.count({ where: { jobId: M.jobs.race2 } });
      check("race: ...never over-staffed, one lead", job?.cleaners.length === 2 && rows === 2 && !!job.employeeId, { job, rows });
    }
    {
      // 10 claims a minute per person; the 11th is 429.
      const x5 = await signIn(HOST_A, M.people.x5.email);
      // Sent together: against staging each request takes seconds, so eleven in
      // a row would outlast the one-minute window.
      const answers = (
        await Promise.all(Array.from({ length: 11 }, (_, i) => claim(`cnotreal${i}0000000000000`, x5)))
      ).map((r) => r.status);
      check(
        "claim: 11 claims in a minute — ten answered, the 11th is 429",
        answers.filter((s) => s === 404).length === 10 && answers.filter((s) => s === 429).length === 1,
        answers,
      );
    }

    // ── Pay ───────────────────────────────────────────────────────────────
    {
      const r = await get("/api/v1/pay", cleaner);
      // $100 paid + a legacy negative payout clamped to 0, less the $10 pending
      // (the $30 rejected one holds nothing).
      check("pay: 200, available = PAID payouts − non-rejected withdrawals, in cents", r.status === 200 && r.body?.balance?.availableCents === 9000, r.body?.balance ?? r.body);
      check("pay: pending carries the DRAFT payout", Number.isInteger(r.body?.balance?.pendingCents) && r.body.balance.pendingCents >= 4000, r.body?.balance);
      check("pay: the withdrawal rules come from the server", r.body?.withdrawal?.feeBasisPoints === 500 && r.body?.withdrawal?.minimumCents === 1, r.body?.withdrawal);
      check("pay: the company's year", r.body?.yearToDate?.year === Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric" }).format(new Date())), r.body?.yearToDate);
      check("pay: no reviews is a null average, never a made-up score", r.body?.rating?.average === null && r.body?.rating?.count === 0, r.body?.rating);
      const ap = await get("/api/v1/pay", applicant);
      check("pay: an APPLICANT is 403", ap.status === 403, ap.body);
      const t = await get("/api/v1/pay", teammate);
      check("pay: another cleaner sees their own balance, not this one's", t.status === 200 && t.body?.balance?.availableCents === 0, t.body?.balance);
    }
    {
      const r = await get("/api/v1/pay/payouts", cleaner);
      const items = r.body?.items ?? [];
      check("payouts: the caller's three, newest first", r.status === 200 && items.length === 3 && items[0].startDate >= items[1].startDate && items[1].startDate >= items[2].startDate, items);
      const legacy = items.find((p: { baseCents: number }) => p.baseCents === 1000);
      check("payouts: a legacy negative payout reads as 0, never below", legacy?.finalCents === 0 && legacy?.deductionsCents === 5000, legacy);
      check("payouts: nothing internal", !/employeeId|notes|price/.test(r.text), r.text.slice(0, 200));
      const t = await get("/api/v1/pay/payouts", teammate);
      check("payouts: another cleaner's list doesn't include them", t.status === 200 && (t.body?.items ?? []).length === 0, t.body);
      const bad = await get("/api/v1/pay/payouts?cursor=%%%", cleaner);
      check("payouts: a forged cursor is 400", bad.status === 400, bad.body);
    }
    {
      const r = await get(`/api/v1/pay/periods/${M.payouts.paid}`, cleaner);
      const line = (r.body?.jobs ?? []).find((j: { jobId: string }) => j.jobId === M.jobs.completed);
      check("period: 200 with its jobs", r.status === 200 && r.body?.period?.id === M.payouts.paid && r.body.period.status === "PAID" && !!line, r.body);
      check("period: a job line is area-only", !!line && line.area === "Le Plateau" && !r.text.includes("Secretstreet") && !r.text.includes("Prem Sai"), line);
      const jp = await get(`/api/v1/pay/jobs/${M.jobs.completed}`, cleaner);
      check("job pay: 200, and the period's line is the same figure", jp.status === 200 && !!line && jp.body?.totalCents === line.totalCents, { jp: jp.body, line });
      check(
        "job pay: nothing internal (no price, tier, pool, client)",
        jp.status === 200 && !/"price"|"tier"|STANDARD|TRAINEE|pool|Prem Sai|Secretstreet/.test(jp.text) && jp.body?.basis === "PERCENTAGE" && jp.body?.ratingBoost?.state === "LOCKED",
        jp.body,
      );
      const cur = await get("/api/v1/pay/periods/current", cleaner);
      check("period: \"current\" is the live week (or its payout)", cur.status === 200 && ["OPEN", "DRAFT", "APPROVED", "PAID"].includes(cur.body?.period?.status), cur.body);
      const theirs = await get(`/api/v1/pay/periods/${M.payouts.paid}`, teammate);
      check("period: another cleaner's payout is 404", theirs.status === 404 && theirs.body?.error?.code === "NOT_FOUND", theirs.body);
      const other = await get(`/api/v1/pay/periods/${M.payouts.otherCompany}`, cleaner);
      check("period: another company's payout is 404", other.status === 404, other.body);
      const tjp = await get(`/api/v1/pay/jobs/${M.jobs.completed}`, teammate);
      check("job pay: a job the caller isn't on is 404", tjp.status === 404, tjp.body);
      const ojp = await get(`/api/v1/pay/jobs/${F.jobs.otherCompany}`, cleaner);
      check("job pay: another company's job is 404", ojp.status === 404, ojp.body);
      const ojp2 = await get(`/api/v1/pay/jobs/${F.jobs.teammates}`, cleaner);
      check("job pay: a teammate's job is 404", ojp2.status === 404, ojp2.body);
    }

    // ── Withdrawals ───────────────────────────────────────────────────────
    {
      const before = await get("/api/v1/pay/withdrawals", cleaner);
      check("withdrawals: the caller's two, newest first, with no payment method", before.status === 200 && before.body?.items?.length === 2 && !/paymentMethod/.test(before.text), before.body);

      const zero = await withdraw(cleaner, 0);
      check("withdraw: zero is 400", zero.status === 400, zero.body);
      const float = await withdraw(cleaner, 12.5);
      check("withdraw: a fraction of a cent is 400", float.status === 400, float.body);
      const badFee = await withdraw(cleaner, 1000, { expectedFeeBasisPoints: 20_000 });
      check("withdraw: a fee rate out of range is 400", badFee.status === 400, badFee.body);

      const fee = await withdraw(cleaner, 1000, { expectedFeeBasisPoints: 400 });
      check("withdraw: a rate the server doesn't hold is 409 FEE_CHANGED", fee.status === 409 && fee.body?.error?.code === "FEE_CHANGED", fee.body);
      const over = await withdraw(cleaner, 9001);
      check(
        "withdraw: more than the balance (checked on the amount ASKED FOR) is 409 INSUFFICIENT_BALANCE with the balance",
        over.status === 409 && over.body?.error?.code === "INSUFFICIENT_BALANCE" && /\$90\.00/.test(over.body?.error?.message ?? ""),
        over.body,
      );

      const alertsBefore = await db.alert.count({ where: { relatedType: "Withdrawal" } });
      const key = randomUUID();
      const ok = await post("/api/v1/pay/withdrawals", cleaner, { amountCents: 2000, expectedFeeBasisPoints: 500, note: "  Rent week  ", clientEventId: key });
      check(
        "withdraw: 200 — fee from the server's rate, the net recorded",
        ok.status === 200 && ok.body?.withdrawal?.amountCents === 1900 && ok.body.withdrawal.feeCents === 100 && ok.body.withdrawal.netCents === 1900 && ok.body.withdrawal.status === "PENDING" && ok.body.withdrawal.note === "Rent week",
        ok.body,
      );
      check("withdraw: the balance left is the balance before, less net + fee", ok.body?.availableCents === 7000, ok.body?.availableCents);
      const row = ok.body?.withdrawal?.id
        ? await db.withdrawal.findUnique({ where: { id: ok.body.withdrawal.id }, select: { amount: true, feeAmount: true, paymentMethod: true, status: true, employeeId: true } })
        : null;
      check("withdraw: the row is the web's shape — net dollars, fee beside it, no method, PENDING, mine", row?.amount === 19 && row.feeAmount === 1 && row.paymentMethod === null && row.status === "PENDING" && row.employeeId === F.users.cleaner.id, row);
      const alerts = await db.alert.count({ where: { relatedType: "Withdrawal" } });
      check("withdraw: one office alert", alerts === alertsBefore + 1, { alertsBefore, alerts });

      const replay = await post("/api/v1/pay/withdrawals", cleaner, { amountCents: 2000, expectedFeeBasisPoints: 500, note: "  Rent week  ", clientEventId: key });
      const rows = await db.withdrawal.count({ where: { employeeId: F.users.cleaner.id } });
      const alertsAfter = await db.alert.count({ where: { relatedType: "Withdrawal" } });
      check(
        "withdraw: a replay returns the stored answer, writes nothing, alerts no one",
        replay.status === 200 && replay.headers["idempotent-replayed"] === "true" && sameJson(replay.body, ok.body) && rows === 3 && alertsAfter === alerts,
        { status: replay.status, rows, alertsAfter },
      );
      const stored = await db.idempotencyRecord.findFirst({ where: { userId: F.users.cleaner.id, key }, select: { responseBody: true } });
      check(
        "withdraw: the idempotency record keeps only the withdrawal's id, not the answer",
        JSON.stringify(stored?.responseBody) === JSON.stringify({ $replayRef: { withdrawalId: ok.body?.withdrawal?.id } }),
        stored?.responseBody,
      );
      const reuse = await post("/api/v1/pay/withdrawals", cleaner, { amountCents: 2500, expectedFeeBasisPoints: 500, clientEventId: key });
      check("withdraw: the same key with a different amount is 422", reuse.status === 422, reuse.body);

      const pay = await get("/api/v1/pay", cleaner);
      check("pay: the balance went down by net + fee", pay.body?.balance?.availableCents === 7000, pay.body?.balance);
      const list = await get("/api/v1/pay/withdrawals", cleaner);
      const top = list.body?.items?.[0];
      check("withdrawals: the new one is first, read back with its fee", top?.id === ok.body?.withdrawal?.id && top.feeCents === 100 && top.netCents === 1900, top);

      const ap = await withdraw(applicant, 100);
      check("withdraw: an APPLICANT is 403", ap.status === 403, ap.body);
      const own = await withdraw(owner, 100);
      check("withdraw: an OWNER calling as staff is 403", own.status === 403, own.body);
    }

    // ── Concurrency: one person's withdrawals, sent at once ───────────────
    {
      // x1 has $100.00. Four requests of $60.00 at once: without the lock each
      // would see the whole balance; with it exactly one fits.
      const x1 = await signIn(HOST_A, M.people.x1.email);
      const results = await Promise.all(
        [0, 1, 2, 3].map(() => postOnce("/api/v1/pay/withdrawals", x1, { amountCents: 6000, expectedFeeBasisPoints: 500, clientEventId: randomUUID() })),
      );
      const won = results.filter((r) => r.status === 200).length;
      const refused = results.filter((r) => r.status === 409 && r.body?.error?.code === "INSUFFICIENT_BALANCE").length;
      check("overdraw: four $60 requests against $100, at once — exactly one succeeds", won === 1 && refused === 3, results.map((r) => [r.status, r.body?.error?.code]));
      const sum = await db.withdrawal.aggregate({ where: { employeeId: M.people.x1.id }, _sum: { amount: true }, _count: true });
      check("overdraw: ...one row, $57.00 net", sum._count === 1 && sum._sum.amount === 57, sum);
    }
    {
      // x2 has $100.00. Three requests of $20.00 at once, then the balance:
      // every one fits in turn, and the balance is exactly 100 − 3 × 20 (net + fee).
      const x2 = await signIn(HOST_A, M.people.x2.email);
      const results = await Promise.all(
        [0, 1, 2].map(() => postOnce("/api/v1/pay/withdrawals", x2, { amountCents: 2000, expectedFeeBasisPoints: 500, clientEventId: randomUUID() })),
      );
      const pay = await get("/api/v1/pay", x2);
      const lefts = results.map((r) => r.body?.availableCents).sort((a, b) => a - b);
      check(
        "overdraw: three $20 requests at once — all three, each seeing the one before",
        results.every((r) => r.status === 200) && pay.body?.balance?.availableCents === 4000 && JSON.stringify(lefts) === JSON.stringify([4000, 6000, 8000]),
        { r: results.map((r) => [r.status, r.body?.availableCents ?? r.body?.error?.code]), left: pay.body?.balance },
      );
    }
    {
      // 5 an hour per person; the 6th is 429. (x3's requests are all at a
      // stale rate, so nothing is written.)
      const x3 = await signIn(HOST_A, M.people.x3.email);
      const answers: number[] = [];
      for (let i = 0; i < 6; i++) answers.push((await withdraw(x3, 100, { expectedFeeBasisPoints: 400 })).status);
      check("withdraw: the 6th request in an hour is 429", answers.slice(0, 5).every((s) => s === 409) && answers[5] === 429, answers);
    }
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
