/**
 * Open the app in a real browser and use it, the way a person would.
 *
 *   npm run dev
 *   npx tsx scripts/click-through.ts [admin|cleaner|customer|all]
 *
 * WHY THIS EXISTS
 * Fetching a page and getting a 200 proves almost nothing here. Next streams:
 * the shell returns 200 immediately and the real content — and any error in it —
 * arrives later in the same response. And a server action only runs when
 * somebody presses the button, so a whole class of failure is invisible until
 * then. That is how 55 broken write paths across 37 files survived a sweep that
 * had "checked" every page: they all loaded fine.
 *
 * So this drives Chromium and watches for what a person would actually hit:
 * a 500, a crashed component, an unhandled exception, a failed action.
 *
 * LOCALHOST ONLY, and deliberately not wired to .env.e2e — a click-through that
 * presses buttons must never be pointed at a database with real customers in it.
 */
import { chromium, type Browser, type Page } from "playwright";

const BASE = process.env.CLICK_BASE ?? "http://teamcleano.localhost:3000";
const PLATFORM = process.env.CLICK_PLATFORM ?? "http://localhost:3000";
const PASSWORD = process.env.CLICK_PASSWORD ?? "StagingPass123!";
// Awer's own staff live in a different workspace, seeded by a different script,
// with a different password. Sharing one variable made the `all` run report a
// failed console sign-in that was only ever the harness using the wrong key.
const STAFF_PASSWORD = process.env.CLICK_STAFF_PASSWORD ?? "PlatformPass123!";

if (!/^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing to click through ${BASE} — localhost only`);
}

type Problem = { where: string; kind: string; detail: string; environment?: boolean };

/**
 * Failures that are about this machine, not about the code.
 *
 * Locally there is no real Stripe key, so the deposit call cannot succeed no
 * matter how correct the app is. Reported separately rather than suppressed:
 * counted as a defect the harness cries wolf and stops being read, and hidden
 * entirely it would mask a genuine break in the payment code.
 */
const ENVIRONMENTAL = [/\/api\/stripe\//];
const problems: Problem[] = [];
let visited = 0;

const note = (where: string, kind: string, detail: string) => {
  // One line per distinct problem; a broken shared component would otherwise
  // report itself once per page and bury everything else.
  const key = `${kind}|${detail}`.slice(0, 200);
  if (!problems.some((p) => `${p.kind}|${p.detail}`.slice(0, 200) === key)) {
    problems.push({ where, kind, detail, environment: ENVIRONMENTAL.some((r) => r.test(detail)) });
  }
};

/** Attach listeners that catch what a person would see as "it broke". */
function watch(page: Page, where: () => string) {
  page.on("pageerror", (e) => note(where(), "uncaught exception", e.message.split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Browser noise that says nothing about the app working.
    if (/favicon|Download the React DevTools|manifest|sw\.js|preload/i.test(t)) return;
    // The browser logs every failed request as a console error too, with no
    // path in the text. The response listener already reports the same event
    // and knows which URL it was, so this copy is dropped rather than counted
    // twice under a name nobody can act on.
    if (/^Failed to load resource/i.test(t)) return;
    note(where(), "console error", t.slice(0, 180));
  });
  page.on("response", (r) => {
    if (r.status() >= 500) note(where(), `HTTP ${r.status()}`, new URL(r.url()).pathname);
  });
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (/ABORTED|net::ERR_ABORTED/.test(f)) return;
    note(where(), "request failed", `${new URL(r.url()).pathname} — ${f}`);
  });
}

/** Did the page render, or is it an error screen / endless spinner? */
async function settle(page: Page, where: string) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    note(where, "never settled", "still loading after 15s");
  }
  const body = await page.locator("body").innerText().catch(() => "");
  if (/Application error|something went wrong|Internal Server Error|Unhandled Runtime/i.test(body)) {
    note(where, "error screen", body.split("\n").filter(Boolean).slice(0, 2).join(" / ").slice(0, 160));
  }
  // The streaming fallback with nothing behind it.
  if (/Crunching the numbers/i.test(body) && body.trim().length < 120) {
    note(where, "stuck on the loading screen", "content never arrived");
  }
}

async function signIn(page: Page, origin: string, path: string, email: string, password = PASSWORD) {
  await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', email);
  await page.fill('input[type="password"], input[name="password"]', password);
  await Promise.all([
    page.waitForLoadState("networkidle").catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  const url = page.url();
  if (/\/(sign-in|login|cleanos)/.test(new URL(url).pathname)) {
    const msg = await page.locator("body").innerText().catch(() => "");
    throw new Error(`sign-in as ${email} did not leave the form — ${msg.slice(0, 140)}`);
  }
  return url;
}

async function walk(page: Page, origin: string, paths: string[], label: string) {
  for (const path of paths) {
    let where = `${label} ${path}`;
    const track = () => where;
    void track;
    visited++;
    process.stdout.write(`  ${path.padEnd(34)}`);
    const before = problems.length;
    await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" }).catch((e) =>
      note(where, "navigation failed", e.message.split("\n")[0]),
    );
    await settle(page, where);
    console.log(problems.length === before ? "ok" : "PROBLEM");
  }
}

const ADMIN = [
  "/admin/dashboard", "/admin/jobs", "/admin/jobs/new", "/admin/calendar",
  "/admin/clients", "/admin/contacts", "/admin/leads", "/admin/quotes",
  "/admin/invoices", "/admin/finances", "/admin/sales", "/admin/kpi",
  "/admin/reports", "/admin/analytics", "/admin/my-team", "/admin/employees",
  "/admin/time-tracking", "/admin/payouts", "/admin/wash-payouts",
  "/admin/availability", "/admin/recurring", "/admin/web-bookings",
  "/admin/inventory", "/admin/inventory/kits", "/admin/inventory/rag-wash",
  "/admin/gift-cards", "/admin/promo-codes", "/admin/bulk-charge",
  "/admin/properties", "/admin/documents", "/admin/training",
  "/admin/training-docs", "/admin/job-applications", "/admin/waitlist",
  "/admin/announcements", "/admin/chat", "/admin/group-chat",
  "/admin/requests", "/admin/logs", "/admin/settings",
];

const CLEANER = [
  "/cleaners/dashboard", "/cleaners/my-jobs", "/cleaners/available-jobs",
  "/cleaners/calendar", "/cleaners/availability", "/cleaners/my-pay",
  "/cleaners/my-inventory", "/cleaners/my-inventory/checkout",
  "/cleaners/my-inventory/history", "/cleaners/my-inventory/rag-wash",
  "/cleaners/documents", "/cleaners/training", "/cleaners/announcements",
  "/cleaners/chat", "/cleaners/group-chat", "/cleaners/strikes",
  "/cleaners/settings",
];

const PUBLIC = ["/book", "/quote", "/careers", "/faq", "/reviews", "/gift-card", "/join-waitlist"];

/**
 * Book a cleaning the way a stranger would, from the postcode to the deposit.
 *
 * This is the revenue path, and it is the one place where "the page loaded" is
 * worth nothing at all: every step is gated on the one before it, and the last
 * step takes money. Needs a ServiceArea covering the postcode, or step 1
 * correctly offers the waiting list instead and there is nothing more to test.
 */
async function bookACleaning(page: Page): Promise<void> {
  const step = async (label: string) => {
    await page.waitForTimeout(1500);
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    const at = (body.match(/STEP \d[^.]{0,60}/) || ["(unknown)"])[0];
    console.log(`  ${label.padEnd(22)} ${at.slice(0, 62)}`);
    return body;
  };
  const tap = async (sel: string) => {
    const l = page.locator(sel).first();
    if (!(await l.count())) return false;
    await l.click().catch(() => {});
    await page.waitForTimeout(300);
    return true;
  };

  await page.goto(`${BASE}/book`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  await page.fill('input[placeholder="H1A 2B3"]', "H2X 1Y4");
  await tap('button:has-text("Check")');
  const covered = await step("postcode");
  if (/Notify me/i.test(covered)) {
    console.log("  — postcode not covered; the waiting list was offered instead");
    console.log("    (seed a ServiceArea to exercise the rest of the flow)");
    return;
  }

  await tap('button:has-text("Continue")');
  await step("property");
  await page.fill('input[placeholder*="Sainte-Catherine"]', "1200 rue Sainte-Catherine O");
  await tap('button:has-text("Standard cleaning")');
  await tap('button:has-text("Apartment / Condo")');
  await tap('button:has-text("One-time")');
  await tap('button:has-text("Continue")');
  await step("schedule");

  await tap('button:has-text("I\'m flexible")');
  await tap('button:has-text("Choose your preferred")');
  await page.waitForTimeout(900);
  const days = page.locator("button:not([disabled])").filter({ hasText: /^\d{1,2}$/ });
  const open = await days.count();
  if (open === 0) {
    note("booking", "no bookable date", "every day in the picker is blocked");
    return;
  }
  console.log(`  ${"bookable days".padEnd(22)} ${open}`);
  await days.first().click().catch(() => {});
  await tap('button:has-text("Continue")');
  await step("contact");

  await page.locator("#c-email").fill(`clickthrough@example.test`).catch(() => {});
  await page.locator("#c-phone").fill("5145550142").catch(() => {});
  await page.locator("#c-name").fill("Clickthrough Harness").catch(() => {});
  const boxes = page.locator('input[type=checkbox]');
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => {});
  await tap('button:has-text("Continue")');
  const review = await step("review");

  if (!/deposit/i.test(review)) note("booking", "review step", "no deposit shown on the final step");

  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check().catch(() => {});
  await page.waitForTimeout(2500);
  const confirm = page.locator('button:has-text("Confirm booking")').first();
  const ready = (await confirm.count()) > 0 && (await confirm.isEnabled().catch(() => false));

  if (!ready) {
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    const noStripe =
      /can't take card payments online yet/i.test(body) ||
      /Could not (initialise|start) the payment/i.test(body);
    const why = noStripe
      ? "this workspace has no Stripe account connected here"
      : "the button never became pressable";
    // Not counted as a defect when the cause is a missing local key: the app
    // told the visitor and refused to take a booking it could not charge for,
    // which is the correct thing to do.
    console.log(`  ${"confirm".padEnd(22)} blocked — ${why}`);
    if (!noStripe) note("booking", "cannot confirm", why);
    return;
  }

  await confirm.click().catch(() => {});
  await page.waitForTimeout(8000);
  const done = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");

  // The confirmation screen greets the customer by name and says a confirmation
  // was sent. Matching a loose word like "confirm" is NOT good enough: it also
  // appears on the review step's own "Confirm booking" button, so a booking
  // that silently failed reported success. That is the same "said it worked
  // without checking" mistake this harness exists to catch.
  const booked = /Thanks,/i.test(done) && /We sent a confirmation to/i.test(done);
  if (booked) {
    console.log("  confirmed               booking went through");
    return;
  }
  // The wizard shows the server's own message in an error banner.
  const banner = (await page
    .locator('[class*="banner"], [role="alert"]')
    .allInnerTexts()
    .catch(() => [] as string[]))
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  note(
    "booking",
    "the booking did not complete",
    banner.length ? banner.join(" | ").slice(0, 200) : done.slice(-200),
  );
}

(async () => {
  const which = (process.argv[2] ?? "all").toLowerCase();
  const browser: Browser = await chromium.launch();

  try {
    if (which === "all" || which === "public") {
      console.log("\nPUBLIC PAGES — no sign-in needed");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      watch(page, () => "public");
      await walk(page, BASE, PUBLIC, "public");
      await ctx.close();
    }

    if (which === "all" || which === "admin") {
      console.log("\nTHE OFFICE — signed in as an admin");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      watch(page, () => `admin ${new URL(page.url()).pathname}`);
      const landed = await signIn(page, BASE, "/sign-in", "admin@teamcleano.test");
      console.log(`  signed in, landed on ${new URL(landed).pathname}`);
      await walk(page, BASE, ADMIN, "admin");
      await ctx.close();
    }

    if (which === "all" || which === "cleaner") {
      console.log("\nTHE CLEANER APP — signed in as a cleaner");
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, // a phone, which is where this is used
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      watch(page, () => `cleaner ${new URL(page.url()).pathname}`);
      const landed = await signIn(page, BASE, "/cleanos/login", "cleaner1@teamcleano.test");
      console.log(`  signed in, landed on ${new URL(landed).pathname}`);
      await walk(page, BASE, CLEANER, "cleaner");
      await ctx.close();
    }

    if (which === "all" || which === "booking") {
      console.log("\nBOOKING A CLEANING — as a stranger, start to finish");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      watch(page, () => `booking ${new URL(page.url()).pathname}`);
      await bookACleaning(page);
      await ctx.close();
    }

    if (which === "all" || which === "console") {
      console.log("\nAWER'S CONSOLE — signed in as staff");
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      watch(page, () => `console ${new URL(page.url()).pathname}`);
      await signIn(page, PLATFORM, "/sign-in", "prem@davnoot.com", STAFF_PASSWORD).catch((e) =>
        note("console", "sign-in failed", e.message),
      );
      await walk(page, PLATFORM, [
        "/console", "/console/workspaces", "/console/staff", "/console/audit",
        "/console/health", "/console/requests", "/console/billing", "/console/trials",
      ], "console");
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const real = problems.filter((p) => !p.environment);
  const env = problems.filter((p) => p.environment);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`${visited} pages opened, ${real.length} problems\n`);
  for (const p of real) console.log(`  [${p.kind}] ${p.where}\n      ${p.detail}`);
  if (env.length) {
    console.log(`\n  not the app — this machine is missing configuration:`);
    for (const p of env) console.log(`    [${p.kind}] ${p.detail}`);
  }
  process.exitCode = real.length === 0 ? 0 : 1;
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exitCode = 1;
});
