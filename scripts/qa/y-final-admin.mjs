/* Final verification sweep — platform + admin surfaces. Scratch; delete after. */
import { open, signIn, visit, report, BASE } from "./harness.mjs";

const PLATFORM = "http://localhost:3006";

const MTL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Montreal",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function mtlNow() {
  const p = Object.fromEntries(MTL.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return p;
}

const out = [];
const t0 = Date.now();

const { browser, page, problems } = await open();

try {
  // ---------- a. PLATFORM front door ----------
  {
    const started = Date.now();
    const res = await page.goto(`${PLATFORM}/get-started`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const body = await page.innerText("body").catch(() => "");
    out.push({
      surface: "PLATFORM /get-started",
      status: res?.status() ?? 0,
      url: page.url(),
      title: await page.title(),
      ms: Date.now() - started,
      errorBoundary: /Application error|Unhandled Runtime Error|something went wrong/i.test(body),
      text: body.replace(/\s+/g, " ").slice(0, 600),
    });
  }

  // ---------- b. TENANT sign-in door ----------
  {
    const started = Date.now();
    const res = await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const body = await page.innerText("body").catch(() => "");
    out.push({
      surface: "TENANT /sign-in",
      status: res?.status() ?? 0,
      url: page.url(),
      title: await page.title(),
      ms: Date.now() - started,
      errorBoundary: /Application error|Unhandled Runtime Error|something went wrong/i.test(body),
      hasEmail: await page.locator('input[type="email"], input[name="email"]').count(),
      text: body.replace(/\s+/g, " ").slice(0, 500),
    });
  }

  // ---------- c. admin sign-in ----------
  let landed = null;
  const signStart = Date.now();
  try {
    landed = await signIn(page, "admin");
  } catch (e) {
    // KNOWN QUIRK: navigation wait can time out after a successful sign-in.
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const u = new URL(page.url());
      if (!/\/(sign-in|cleanos\/login)$/.test(u.pathname)) { landed = u.pathname; break; }
    }
    out.push({ surface: "signIn(admin) quirk", note: String(e).slice(0, 160), landed });
  }
  out.push({ surface: "admin signIn", landed, ms: Date.now() - signStart });

  const dash = await visit(page, "/admin/dashboard");
  out.push({
    surface: "/admin/dashboard",
    status: dash.status,
    url: dash.url,
    errorBoundary: dash.errorBoundary,
    ms: null,
    text: dash.text.replace(/\s+/g, " ").slice(0, 500),
  });

  // ---------- d. the admin pages ----------
  const pages = [
    "/admin/jobs",
    "/admin/calendar",
    "/admin/issues",
    "/admin/announcements",
    "/admin/notifications",
    "/admin/time-tracking",
    "/admin/recurring",
    "/admin/employees",
    "/admin/clients",
  ];
  for (const p of pages) {
    const started = Date.now();
    const r = await visit(page, p);
    out.push({
      surface: p,
      status: r.status,
      url: r.url,
      errorBoundary: r.errorBoundary,
      ms: Date.now() - started,
      text: r.text.replace(/\s+/g, " ").slice(0, 320),
    });
  }

  // ---------- g. calendar store day ----------
  {
    await visit(page, "/admin/calendar");
    await page.waitForSelector(".cal-month-grid", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const todayCells = await page.locator(".cal-mcell.today .cal-mdate").allInnerTexts();
    const header = await page
      .locator("h1, h2, .cal-title, [class*='cal-head']")
      .allInnerTexts()
      .catch(() => []);
    const mini = await page.locator(".mini-day.today, .mini-cal .today").allInnerTexts().catch(() => []);
    const m = mtlNow();
    out.push({
      surface: "calendar store-day",
      montrealNow: `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute} America/Montreal`,
      machineNow: new Date().toString(),
      todayCellDayNumbers: todayCells,
      miniTodayCells: mini.slice(0, 5),
      headerText: header.slice(0, 6).map((t) => t.replace(/\s+/g, " ").slice(0, 80)),
      expectedDayNumber: String(Number(m.day)),
    });
  }

  // ---------- e. settings + tabs ----------
  {
    const started = Date.now();
    const r = await visit(page, "/admin/settings");
    const loadMs = Date.now() - started;
    await page.waitForSelector("button.smenu-item", { timeout: 90000 }).catch(() => {});
    const labels = await page.locator("button.smenu-item span:first-of-type").allInnerTexts();
    out.push({
      surface: "/admin/settings (page load, Stripe reconcile inside)",
      status: r.status,
      errorBoundary: r.errorBoundary,
      ms: loadMs,
      tabCount: labels.length,
      tabs: labels,
      text: r.text.replace(/\s+/g, " ").slice(0, 300),
    });

    const tabResults = [];
    for (const label of labels) {
      const btn = page.locator("button.smenu-item", { hasText: label }).first();
      const s = Date.now();
      await btn.click().catch(() => {});
      await page.waitForTimeout(250);
      const head = await page.locator(".set-panel-head h2").first().innerText().catch(() => "");
      const bodyTxt = await page.innerText("body").catch(() => "");
      tabResults.push({
        tab: label,
        head,
        ms: Date.now() - s,
        broken: /Application error|Unhandled Runtime Error|something went wrong/i.test(bodyTxt),
        snippet: bodyTxt.replace(/\s+/g, " ").slice(0, 0),
      });
    }
    out.push({ surface: "settings tabs (client-side switch)", tabs: tabResults });

    // Plan tab measured on its own, twice: cold nav and warm nav.
    for (const pass of ["cold", "warm"]) {
      const s = Date.now();
      const r2 = await visit(page, "/admin/settings?tab=plan");
      const ms = Date.now() - s;
      const head = await page.locator(".set-panel-head h2").first().innerText().catch(() => "");
      const planTxt = await page.innerText("body").catch(() => "");
      out.push({
        surface: `/admin/settings?tab=plan (${pass} full page load incl. Stripe)`,
        status: r2.status,
        ms,
        head,
        errorBoundary: r2.errorBoundary,
        text: planTxt.replace(/\s+/g, " ").slice(0, 600),
      });
    }
  }
} finally {
  report("FINAL-ADMIN", out, problems);
  console.log(`TOTAL_MS=${Date.now() - t0}`);
  await browser.close();
}
