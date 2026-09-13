/* Final verification — same surfaces, but no networkidle wait (the app polls
   forever, so networkidle can never fire). Scratch; delete after. */
import { open, signIn, report, BASE } from "./harness.mjs";

const PLATFORM = "http://localhost:3006";

async function land(page, url, settleMs = 2500) {
  const started = Date.now();
  let status = 0;
  let err = null;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
    status = res?.status() ?? 0;
  } catch (e) {
    err = String(e).slice(0, 200);
  }
  await page.waitForTimeout(settleMs);
  const body = await page.innerText("body").catch(() => "");
  return {
    url,
    status,
    landedOn: page.url(),
    ms: Date.now() - started,
    navError: err,
    errorBoundary:
      /Application error|Unhandled Runtime Error|something went wrong|This job didn't load/i.test(body),
    title: await page.title().catch(() => ""),
    text: body.replace(/\s+/g, " ").slice(0, 350),
  };
}

const out = [];
const { browser, page, problems } = await open();

try {
  out.push({ step: "a PLATFORM", ...(await land(page, `${PLATFORM}/get-started`)) });
  out.push({ step: "b TENANT sign-in", ...(await land(page, `${BASE}/sign-in`)) });

  const s0 = Date.now();
  let landed = null;
  try {
    landed = await signIn(page, "admin");
  } catch (e) {
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(2000);
      if (!/\/sign-in$/.test(new URL(page.url()).pathname)) { landed = new URL(page.url()).pathname; break; }
    }
    out.push({ step: "c signIn quirk", note: String(e).slice(0, 140) });
  }
  out.push({ step: "c admin signIn", landed, ms: Date.now() - s0 });

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
    out.push({ step: `d ${p}`, ...(await land(page, `${BASE}${p}`)) });
  }

  // e. settings + every tab
  const settings = await land(page, `${BASE}/admin/settings`, 4000);
  out.push({ step: "e /admin/settings", ...settings });
  await page.waitForSelector("button.smenu-item", { timeout: 90000 }).catch(() => {});
  const labels = await page.locator("button.smenu-item").allInnerTexts();
  const tabs = [];
  for (const raw of labels) {
    const label = raw.split("\n")[0].trim();
    const s = Date.now();
    await page.locator("button.smenu-item", { hasText: label }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const head = await page.locator(".set-panel-head h2").first().innerText().catch(() => "");
    const body = await page.innerText("body").catch(() => "");
    tabs.push({
      tab: label,
      head,
      ms: Date.now() - s,
      broken: /Application error|Unhandled Runtime Error|something went wrong/i.test(body),
      couldNotLoad: /could not be loaded|couldn't be loaded/i.test(body),
    });
  }
  out.push({ step: "e settings tabs", count: tabs.length, tabs });

  // Plan tab on its own: full server round trip, Stripe inside.
  for (const pass of [1, 2]) {
    out.push({ step: `e plan tab full load #${pass}`, ...(await land(page, `${BASE}/admin/settings?tab=plan`, 3000)) });
  }
} finally {
  report("FINAL-FAST", out, problems);
  await browser.close();
}
