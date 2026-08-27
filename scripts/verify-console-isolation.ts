/**
 * Can a customer's admin see Awer's console, or anything in it?
 *
 *   npm run dev            # in another terminal
 *   DATABASE_URL="$ELEVATED_URL" npx tsx scripts/verify-console-isolation.ts
 *
 * This is an HTTP test, not a database one, and that is the point. The console
 * layout DOES refuse a non-staff visitor — it redirects. What it cannot do is
 * stop the page underneath from running, because Next renders a layout and its
 * children in parallel. So the redirect decided what the browser did next while
 * the page's queries had already run and been flushed into the body of that
 * same response. Nothing in the database was wrong, no query returned the wrong
 * rows, and every other company's name still went out over the wire.
 *
 * A test that only asked the database would have passed. So this one asks the
 * server, the way an attacker would: sign in as an ordinary customer's admin,
 * replay that cookie at the console, and read what actually comes back.
 *
 * The control at the end is not optional. Without it, a console that is simply
 * broken — 500 on every page — passes every assertion above it.
 */
import { PrismaClient } from "@prisma/client";
import { assertSafeTarget } from "../src/lib/safe-target";

/**
 * Real origins, not a Host header against 127.0.0.1.
 *
 * Node's fetch silently drops a `host` header — the request went to the bare
 * domain, the sign-in failed with a 401, and the whole suite errored out. Which
 * address is being asked for is the entire subject of this test, so it has to
 * be the address that is really used. Browsers resolve `*.localhost` to the
 * loopback themselves, and so does macOS, with no DNS entry needed.
 */
const TENANT_ORIGIN = process.env.CONSOLE_TEST_TENANT_ORIGIN ?? "http://teamcleano.localhost:3000";
const PLATFORM_ORIGIN = process.env.CONSOLE_TEST_PLATFORM_ORIGIN ?? "http://localhost:3000";
const TENANT_USER = process.env.CONSOLE_TEST_TENANT_USER ?? "admin@teamcleano.test";
const TENANT_PASS = process.env.CONSOLE_TEST_TENANT_PASS ?? "StagingPass123!";
const STAFF_USER = process.env.CONSOLE_TEST_STAFF_USER ?? "prem@davnoot.com";
const STAFF_PASS = process.env.CONSOLE_TEST_STAFF_PASS ?? "PlatformPass123!";

const PAGES = [
  "/console",
  "/console/workspaces",
  "/console/staff",
  "/console/audit",
  "/console/health",
  "/console/requests",
  "/console/billing",
  "/console/trials",
];

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

/** Sign in and return the session cookie, or throw with why not. */
async function signIn(origin: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  });
  if (!res.ok) throw new Error(`sign-in for ${email} at ${origin} returned ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const token = raw.map((c) => c.split(";")[0]).find((c) => c.includes("session_token"));
  if (!token) throw new Error(`sign-in for ${email} set no session cookie`);
  return token;
}

const get = (origin: string, path: string, cookie: string) =>
  fetch(`${origin}${path}`, { headers: { cookie }, redirect: "manual" }).then((r) =>
    r.text().then((body) => ({ status: r.status, body })),
  );

(async () => {
  // Unlike the other verify scripts this one needs a RUNNING SERVER, because
  // what it checks is what goes out over the wire. In the default sweep there
  // is not one, so it says so and stands down rather than reporting a failure
  // that means nothing. `npm run verify` renders a SKIP line for this.
  // The default sweep inherits whatever DATABASE_URL is lying around, and in
  // this repo that is production. Standing down is the right answer, but it is
  // not a failure, so say so and skip rather than colouring the sweep red.
  try {
    assertSafeTarget(process.env.DATABASE_URL, "test");
  } catch (e) {
    console.log(`SKIP verify-console-isolation — ${(e as Error).message}`);
    return;
  }

  try {
    await fetch(`${PLATFORM_ORIGIN}/get-started`);
  } catch {
    console.log(`SKIP verify-console-isolation — no server at ${PLATFORM_ORIGIN}; start one with \`npm run dev\``);
    return;
  }

  const orgs = await db.organization.findMany({ select: { slug: true, name: true } });
  const tenantSlug = new URL(TENANT_ORIGIN).hostname.split(".")[0];
  // What must never appear: any OTHER company's name or slug. The signed-in
  // admin's own company is excluded, since their own name is theirs to see.
  const secrets = orgs
    .filter((o) => o.slug !== tenantSlug && o.slug !== "platform")
    .flatMap((o) => [o.name, o.slug])
    .filter((v) => v && v.length > 3);

  if (secrets.length === 0) {
    throw new Error(
      "need at least one organization besides the test tenant, or there is nothing that could leak",
    );
  }
  console.log(`watching for ${secrets.length} strings that belong to other companies\n`);

  console.log("A CUSTOMER'S ADMIN, REPLAYING THEIR COOKIE AT THE CONSOLE");
  const tenantCookie = await signIn(TENANT_ORIGIN, TENANT_USER, TENANT_PASS);
  ok(`signed in as ${TENANT_USER} on their own workspace`);

  for (const path of PAGES) {
    const { body } = await get(PLATFORM_ORIGIN, path, tenantCookie);
    const leaked = secrets.filter((s) => body.includes(s));
    leaked.length === 0
      ? ok(`${path} gave away nothing`)
      : bad(path, `leaked ${leaked.length}: ${leaked.slice(0, 3).join(", ")}`);
  }

  console.log("\nTHE CONTROL: THE CONSOLE STILL WORKS FOR AWER'S OWN STAFF");
  // Without this, a console broken in any way passes everything above.
  const staffCookie = await signIn(PLATFORM_ORIGIN, STAFF_USER, STAFF_PASS);
  ok(`signed in as ${STAFF_USER}`);

  const { status, body } = await get(PLATFORM_ORIGIN, "/console", staffCookie);
  status === 200 ? ok("the console renders") : bad("console status", String(status));
  const visible = secrets.filter((s) => body.includes(s));
  visible.length > 0
    ? ok(`staff can see other workspaces (${visible.length} names present)`)
    : bad("control", "staff saw no workspaces either — this suite proves nothing");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})()
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
