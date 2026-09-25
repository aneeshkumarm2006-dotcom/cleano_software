// READ-ONLY admin visual verification.
// Logs in once, then navigates each admin page by URL and screenshots it.
// It NEVER clicks charge/send/delete/save — navigation + screenshot only.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.useawer.com";
const OUT = path.join(process.cwd(), "scripts", "shots");
fs.mkdirSync(OUT, { recursive: true });

// Read creds from .env.e2e (gitignored) — never logged.
const envRaw = fs.readFileSync(path.join(process.cwd(), ".env.e2e"), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const EMAIL = env.E2E_EMAIL;
const PASSWORD = env.E2E_PASSWORD;

const PAGES = [
  ["dashboard", "/admin/dashboard"],
  ["jobs", "/admin/jobs"],
  ["bulk-charge", "/admin/bulk-charge"],
  ["analytics", "/admin/analytics"],
  ["kpi", "/admin/kpi"],
  ["calendar", "/admin/calendar"],
  ["clients", "/admin/clients"],
  ["employees", "/admin/employees"],
  ["inventory", "/admin/inventory"],
  ["settings", "/admin/settings"],
  ["payouts", "/admin/payouts"],
  ["waitlist", "/admin/waitlist"],
  ["job-applications", "/admin/job-applications"],
  ["web-bookings", "/admin/web-bookings"],
  ["requests", "/admin/requests"],
];

const log = (m) => console.log(m);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

try {
  // ---- LOGIN (the only form interaction) ----
  log("→ loading login page…");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, "00-login.png") });

  // Fill whichever email/password fields exist.
  const emailSel = 'input[type="email"], input[name="email"], input[autocomplete="username"]';
  const passSel = 'input[type="password"], input[name="password"]';
  await page.fill(emailSel, EMAIL, { timeout: 15000 }).catch(() => {});
  await page.fill(passSel, PASSWORD, { timeout: 15000 }).catch(() => {});
  await page.keyboard.press("Enter");
  // Wait for either a redirect to /admin or a dashboard element.
  await page.waitForURL(/\/admin/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const afterLogin = page.url();
  log(`→ after login URL: ${afterLogin}`);
  await page.screenshot({ path: path.join(OUT, "01-after-login.png") });

  if (!afterLogin.includes("/admin")) {
    log("✗ LOGIN DID NOT REACH /admin — stopping. (see 00-login.png / 01-after-login.png)");
    await browser.close();
    process.exit(2);
  }
  log("✓ logged in.");

  // ---- READ-ONLY PAGE SWEEP ----
  let i = 2;
  for (const [name, route] of PAGES) {
    const n = String(i++).padStart(2, "0");
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500); // let data + stats render
      await page.screenshot({ path: path.join(OUT, `${n}-${name}.png`), fullPage: false });
      log(`  ✓ ${name}`);
    } catch (e) {
      log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
    }
  }

  log(`\nDone. Screenshots in scripts/shots/`);
} catch (e) {
  log(`FATAL: ${e.message}`);
} finally {
  await browser.close();
}
