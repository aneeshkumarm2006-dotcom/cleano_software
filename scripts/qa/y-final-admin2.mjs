/* Final verification — admin surfaces, resilient to better-auth's 5-per-60s
   rate limit (src/lib/auth.ts rateLimit), which bounces a signed-in admin back
   to /sign-in when the bucket is empty. Scratch; delete after. */
import { open, signIn, report, BASE, ACCOUNTS } from "./harness.mjs";

const PLATFORM = "http://localhost:3006";
const bounced = (u) => /\/sign-in(\?|$)|\/cleanos\/login/.test(u);

async function land(page, url, settleMs = 2500) {
  const started = Date.now();
  let status = 0;
  let navError = null;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
    status = res?.status() ?? 0;
  } catch (e) {
    navError = String(e).slice(0, 160);
  }
  await page.waitForTimeout(settleMs);
  const body = await page.innerText("body").catch(() => "");
  return {
    url,
    status,
    landedOn: page.url(),
    ms: Date.now() - started,
    navError,
    errorBoundary:
      /Application error|Unhandled Runtime Error|something went wrong|This job didn't load/i.test(body),
    title: await page.title().catch(() => ""),
    text: body.replace(/\s+/g, " ").slice(0, 340),
  };
}

/** Land, and if the auth rate limit bounced us, wait the window out and retry. */
async function landAuthed(page, url, settleMs = 2500, tries = 3) {
  let r = await land(page, url, settleMs);
  let attempts = 1;
  while (bounced(r.landedOn) && attempts < tries) {
    await page.waitForTimeout(65000); // better-auth window is 60s
    r = await land(page, url, settleMs);
    attempts++;
  }
  return { ...r, attempts, rateLimited: attempts > 1 };
}

async function signInAdmin(page) {
  const acct = ACCOUNTS.admin;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${BASE}${acct.door}`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"], input[name="email"]', acct.email);
    await page.fill('input[type="password"], input[name="password"]', acct.password);
    await page.click('button[type="submit"]');
    // Poll the URL rather than trusting the navigation event (known quirk).
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(2000);
      if (!bounced(page.url())) return { ok: true, attempt, landed: new URL(page.url()).pathname };
    }
    await page.waitForTimeout(65000); // let the rate-limit window drain
  }
  return { ok: false, landed: page.url() };
}

const out = [];
const { browser, page, problems } = await open();

try {
  out.push({ step: "a PLATFORM /get-started", ...(await land(page, `${PLATFORM}/get-started`)) });
  out.push({ step: "b TENANT /sign-in", ...(await land(page, `${BASE}/sign-in`)) });

  const s0 = Date.now();
  const si = await signInAdmin(page);
  out.push({ step: "c admin signIn", ...si, ms: Date.now() - s0 });

  if (si.ok) {
    for (const p of [
      "/admin/dashboard",
      "/admin/jobs",
      "/admin/calendar",
      "/admin/issues",
      "/admin/announcements",
      "/admin/notifications",
      "/admin/time-tracking",
      "/admin/recurring",
      "/admin/employees",
      "/admin/clients",
    ]) {
      out.push({ step: `d ${p}`, ...(await landAuthed(page, `${BASE}${p}`)) });
    }

    // g. store day, read off the month grid that is already open.
    const mtl = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Montreal",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date()).map((x) => [x.type, x.value]),
    );
    const cal = await landAuthed(page, `${BASE}/admin/calendar`, 6000);
    const todayCells = await page.locator(".cal-mcell.today .cal-mdate").allInnerTexts().catch(() => []);
    const dayNow = await page.evaluate(() => {
      const el = document.querySelector(".z-50.pointer-events-none");
      return el ? { top: getComputedStyle(el).top } : null;
    });
    out.push({
      step: "g calendar store day",
      calStatus: cal.status,
      storeNow: `${mtl.year}-${mtl.month}-${mtl.day} ${mtl.hour}:${mtl.minute} America/Montreal`,
      machineNow: new Date().toString(),
      todayCellDayNumbers: todayCells,
      expectedStoreDay: String(Number(mtl.day)),
      nowLine: dayNow,
    });

    // e. settings and every tab.
    const settings = await landAuthed(page, `${BASE}/admin/settings`, 5000);
    out.push({ step: "e /admin/settings (Stripe reconcile runs server-side here)", ...settings });
    await page.waitForSelector("button.smenu-item", { timeout: 60000 }).catch(() => {});
    const labels = await page.locator("button.smenu-item").allInnerTexts();
    const tabs = [];
    for (const raw of labels) {
      const label = raw.split("\n")[0].trim();
      const s = Date.now();
      await page.locator("button.smenu-item", { hasText: label }).first().click().catch(() => {});
      await page.waitForTimeout(350);
      const head = await page.locator(".set-panel-head h2").first().innerText().catch(() => "");
      const body = await page.innerText("body").catch(() => "");
      tabs.push({
        tab: label,
        head,
        ms: Date.now() - s,
        broken: /Application error|Unhandled Runtime Error|something went wrong/i.test(body),
        degraded: /could not be loaded|couldn't be loaded/i.test(body),
      });
    }
    out.push({ step: "e settings tabs", count: tabs.length, tabs });

    for (const pass of [1, 2]) {
      const r = await landAuthed(page, `${BASE}/admin/settings?tab=plan`, 3000);
      const planText = await page.innerText("body").catch(() => "");
      out.push({
        step: `e plan tab, full server load #${pass}`,
        ...r,
        planPanel: planText.replace(/\s+/g, " ").match(/Plan.{0,400}/)?.[0] ?? "",
      });
    }
  }
} finally {
  report("FINAL-ADMIN2", out, problems);
  await browser.close();
}
