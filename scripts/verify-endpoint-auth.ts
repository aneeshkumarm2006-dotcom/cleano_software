/**
 * Every API route, asked the same three questions.
 *
 *   npm run dev
 *   DATABASE_URL="$LOCAL_URL" npx tsx scripts/verify-endpoint-auth.ts
 *
 * WHY AS AN HTTP TEST
 * The proxy's matcher deliberately excludes /api/*, so NONE of these routes get
 * a session gate from it. Each one defends itself, and several delegate that
 * defence inward to a helper with a comment saying it is handled. Reading the
 * comment proves nothing; this asks the running server.
 *
 * Three callers, because the interesting failures differ:
 *   anonymous — is anything readable with no session at all?
 *   cleaner   — the lowest-privilege real account. Can it reach the office?
 *   admin     — the control. If this cannot read it either, the test is
 *               measuring a broken endpoint rather than a working guard.
 *
 * And one more question the other two cannot ask: a valid admin of ONE company
 * requesting ANOTHER company's object by id. That is the failure that looks
 * like success — a 200, with somebody else's data in it.
 */
import { PrismaClient } from "@prisma/client";
import { assertSafeTarget } from "../src/lib/safe-target";

const TENANT = process.env.AUTH_TEST_ORIGIN ?? "http://teamcleano.localhost:3000";
const PLATFORM = process.env.AUTH_TEST_PLATFORM ?? "http://localhost:3000";
const PASSWORD = process.env.AUTH_TEST_PASSWORD ?? "StagingPass123!";

const db = new PrismaClient();
let pass = 0,
  fail = 0;
const ok = (m: string) => {
  pass++;
  console.log(`  ok    ${m}`);
};
const bad = (m: string, d: string) => {
  fail++;
  console.log(`  FAIL  ${m} — ${d}`);
};

async function signIn(origin: string, email: string): Promise<string> {
  const res = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: "manual",
  });
  if (!res.ok) throw new Error(`sign-in ${email} -> ${res.status}`);
  const c = (res.headers.getSetCookie?.() ?? [])
    .map((x) => x.split(";")[0])
    .find((x) => x.includes("session_token"));
  if (!c) throw new Error(`no session cookie for ${email}`);
  return c;
}

type Probe = { status: number; body: string };
const get = (origin: string, path: string, cookie?: string): Promise<Probe> =>
  fetch(`${origin}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
    // The body is kept WHOLE. Truncating it here silently broke the calendar
    // check: the admin's month is 14KB, JSON.parse failed on the cut-off text,
    // and the suite reported "the admin saw no jobs" — a passing guard dressed
    // up as a finding. Trim at the point of printing, never before parsing.
  }).then(async (r) => ({ status: r.status, body: await r.text() }));

/**
 * Does this response actually carry data, as opposed to a refusal or zeroes?
 *
 * Matching a JSON KEY is not enough and cost me a false alarm: `"leads":`
 * appears in `{"leads":0}`, which is the guard WORKING. A counts endpoint only
 * leaks if some count is non-zero.
 */
function carriesData(p: Probe, needles: string[]): string | null {
  for (const n of needles) {
    if (!n) continue;
    if (n.endsWith('":')) {
      // A count key: only interesting when the number is not zero.
      const m = new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\d+)`).exec(p.body);
      if (m && Number(m[1]) > 0) return `${n}${m[1]}`;
      continue;
    }
    if (p.body.includes(n)) return n;
  }
  return null;
}

(async () => {
  try {
    assertSafeTarget(process.env.DATABASE_URL, "test");
  } catch (e) {
    console.log(`SKIP verify-endpoint-auth — ${(e as Error).message}`);
    return;
  }
  try {
    await fetch(`${PLATFORM}/get-started`);
  } catch {
    console.log(`SKIP verify-endpoint-auth — no server at ${PLATFORM}`);
    return;
  }

  const cleaner = await signIn(TENANT, "cleaner1@teamcleano.test");
  const admin = await signIn(TENANT, "admin@teamcleano.test");
  ok("signed in as a cleaner and as an admin");

  // Something that belongs to ANOTHER company, to ask for by id.
  const other = await db.organization.findFirst({
    where: { slug: { notIn: ["teamcleano", "platform"] } },
    select: { id: true, slug: true },
  });
  const foreignJob = other
    ? await db.job.findFirst({ where: { organizationId: other.id }, select: { id: true, clientName: true } })
    : null;
  console.log("\nCRON — these send email and SMS and write payroll");
  for (const p of ["/api/cron/reminders", "/api/cron/notifications", "/api/cron/weekly", "/api/cron/monthly"]) {
    const anon = await get(PLATFORM, p);
    anon.status === 401 || anon.status === 403
      ? ok(`${p} refuses an anonymous caller (${anon.status})`)
      : bad(p, `anonymous got ${anon.status} — anyone on the internet can trigger this`);
    // A signed-in admin is still not a cron runner.
    const asAdmin = await get(TENANT, p, admin);
    asAdmin.status === 401 || asAdmin.status === 403
      ? ok(`${p} refuses a signed-in admin too — it wants the secret, not a session`)
      : bad(p, `an admin session got ${asAdmin.status}`);
  }

  console.log("\nANONYMOUS READS");
  const anonChecks: [string, string, string[]][] = [
    ["/api/chat/unread", "chat unread", ["message", "preview"]],
    ["/api/job-chat/unread?scope=admin", "job chat unread", ["message"]],
    ["/api/admin/attention-counts", "admin attention counts", ['"jobs":', '"leads":']],
    ["/api/calendar/range?start=2026-08-01&end=2026-08-31", "calendar range", ["clientName", "address"]],
  ];
  for (const [path, label, needles] of anonChecks) {
    const r = await get(TENANT, path);
    const leak = carriesData(r, needles);
    if (leak) {
      bad(label, `anonymous read data (${r.status}) containing "${leak}"`);
    } else if (r.status >= 500) {
      // No data escaped, but a refusal answered as a server fault buries real
      // incidents in a pile of expected 500s.
      bad(label, `refused correctly but with status ${r.status} — a refusal is not a server error`);
    } else {
      ok(`${label} gives an anonymous caller nothing (${r.status})`);
    }
  }

  console.log("\nA CLEANER REACHING FOR THE OFFICE");
  {
    const path = "/api/admin/attention-counts";
    const asCleaner = await get(TENANT, path, cleaner);
    const asAdmin = await get(TENANT, path, admin);
    const cLeak = carriesData(asCleaner, ['"leads":']);
    const aHas = carriesData(asAdmin, ['"leads":']);
    if (!aHas) bad(path, "the ADMIN saw nothing either — this check proves nothing");
    else if (cLeak) bad(path, `a cleaner read office data containing "${cLeak}"`);
    else ok(`${path} — admin sees it, cleaner does not`);
  }

  // The calendar is NOT office-only: a cleaner uses it for their own shifts.
  // So the question is not "can they see it" but "do they see anybody else's
  // work" — every job they get back must be one assigned to them.
  {
    const path = "/api/calendar/range?start=2026-08-01&end=2026-08-31";
    const asAdmin = await get(TENANT, path, admin);
    const asCleaner = await get(TENANT, path, cleaner);

    const jobIds = (body: string): string[] => {
      try {
        const days = (JSON.parse(body).data ?? {}) as Record<string, { metadata?: { jobId?: string } }[]>;
        return Object.values(days).flatMap((d) => d.map((e) => e.metadata?.jobId).filter(Boolean) as string[]);
      } catch {
        return [];
      }
    };
    const adminJobs = jobIds(asAdmin.body);
    const cleanerJobs = jobIds(asCleaner.body);

    if (adminJobs.length === 0) {
      bad(path, "the admin saw no jobs at all — seed data cannot support this check");
    } else {
      ok(`the office sees the whole month (${adminJobs.length} jobs)`);
      const me = await db.user.findFirstOrThrow({
        where: { email: "cleaner1@teamcleano.test" },
        select: { id: true },
      });
      const mine = await db.jobAssignment.findMany({
        where: { jobId: { in: cleanerJobs }, cleanerId: me.id },
        select: { jobId: true },
      });
      const notMine = cleanerJobs.filter((j) => !mine.some((m) => m.jobId === j));
      notMine.length === 0
        ? ok(`a cleaner sees only their own shifts (${cleanerJobs.length} of ${adminJobs.length})`)
        : bad(path, `a cleaner saw ${notMine.length} job(s) not assigned to them`);
    }
  }

  console.log("\nASKING FOR ANOTHER COMPANY'S OBJECT BY ID");
  if (!foreignJob) {
    console.log("  (skipped — no second company with a job to ask for)");
  } else {
    for (const path of [`/api/receipts/${foreignJob.id}`, `/api/admin/jobs/${foreignJob.id}/logs`]) {
      const r = await get(TENANT, path, admin);
      const leaked = r.status === 200 && foreignJob.clientName && r.body.includes(foreignJob.clientName);
      leaked
        ? bad(path, `returned ${other!.slug}'s data to a teamcleano admin`)
        : ok(`${path} — refused (${r.status}), no cross-company data`);
    }
  }

  console.log("\nWEBHOOKS AND INBOUND");
  const forged = await fetch(`${PLATFORM}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=forged" },
    body: JSON.stringify({ id: "evt_forged", type: "payment_intent.succeeded", data: { object: {} } }),
  });
  forged.status === 400
    ? ok("a forged Stripe signature is rejected (400)")
    : bad("stripe webhook", `forged signature got ${forged.status}`);

  const twilio = await fetch(`${PLATFORM}/api/twilio/inbound`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "From=%2B15550001111&To=%2B15550002222&Body=forged",
  });
  const twilioBody = await twilio.text();
  if (twilio.status === 403 || twilio.status === 401) {
    ok(`an unsigned Twilio POST is rejected (${twilio.status})`);
  } else if (twilio.status === 200 && /<Response><\/Response>/.test(twilioBody)) {
    // No TWILIO_AUTH_TOKEN here, so the route accepts and ignores rather than
    // letting Twilio retry-storm. It processes nothing, which is why this is
    // reported as configuration rather than a hole — but it is worth knowing
    // that a production deploy MISSING that variable would silently drop every
    // inbound text.
    ok("Twilio is unconfigured here; the route processes nothing (empty TwiML)");
    console.log("        note: set TWILIO_AUTH_TOKEN in production or inbound texts are dropped");
  } else {
    bad("twilio inbound", `unsigned POST got ${twilio.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})()
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
