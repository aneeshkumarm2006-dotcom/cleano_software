// READ-ONLY cleaner-app visual sweep. Logs in as a cleaner, navigates each
// cleaner page by URL, screenshots it. Never clicks clock-in / claim / cancel /
// submit — navigation + screenshot only.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.useawer.com";
const OUT = path.join(process.cwd(), "scripts", "shots-cleaner");
fs.mkdirSync(OUT, { recursive: true });

const envRaw = fs.readFileSync(path.join(process.cwd(), ".env.e2e"), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const EMAIL = env.E2E_CLEANER_EMAIL, PASSWORD = env.E2E_CLEANER_PASSWORD;

const PAGES = [
  ["dashboard", "/cleaners/dashboard"],
  ["my-jobs", "/cleaners/my-jobs"],
  ["available-jobs", "/cleaners/available-jobs"],
  ["calendar", "/cleaners/calendar"],
  ["my-pay", "/cleaners/my-pay"],
  ["my-inventory", "/cleaners/my-inventory"],
  ["inventory-history", "/cleaners/my-inventory/history"],
  ["inventory-checkout", "/cleaners/my-inventory/checkout"],
  ["inventory-resolve", "/cleaners/my-inventory/resolve"],
  ["availability", "/cleaners/availability"],
  ["training", "/cleaners/training"],
  ["documents", "/cleaners/documents"],
  ["chat", "/cleaners/chat"],
  ["group-chat", "/cleaners/group-chat"],
  ["announcements", "/cleaners/announcements"],
  ["strikes", "/cleaners/strikes"],
  ["settings", "/cleaners/settings"],
];

const log = (m) => console.log(m);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const results = [];

async function shot(prefix, name, route) {
  const n = String(prefix).padStart(2, "0");
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2200);
    const status = resp ? resp.status() : 0;
    const url = page.url();
    const body = (await page.textContent("body").catch(() => "")) || "";
    const err = /something went wrong|application error|unexpected error|this page could|not found/i.test(body.slice(0, 400));
    await page.screenshot({ path: path.join(OUT, `${n}-${name}.png`) });
    const flag = err ? "⚠ error text" : (url.includes("/sign-in") ? "⚠ bounced to login" : "ok");
    results.push({ name, route, status, flag });
    log(`  ${flag === "ok" ? "✓" : "⚠"} ${name} [HTTP ${status}] ${flag === "ok" ? "" : flag}`);
  } catch (e) {
    results.push({ name, route, status: "ERR", flag: e.message.split("\n")[0] });
    log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
  }
}

try {
  log("── CLEANER LOGIN (dedicated cleaner login page) ──");
  await page.goto(`${BASE}/cleanos/login`, { waitUntil: "networkidle", timeout: 45000 });
  const emailBox = page.locator('input[type="email"], input[name="email"]').first();
  const passBox = page.locator('input[type="password"], input[name="password"]').first();
  await emailBox.waitFor({ state: "visible", timeout: 15000 });
  // Type (not fill) so React onChange fires; verify the value stuck before submit.
  await emailBox.click();
  await emailBox.fill("");
  await emailBox.type(EMAIL, { delay: 20 });
  await passBox.click();
  await passBox.fill("");
  await passBox.type(PASSWORD, { delay: 20 });
  await page.waitForTimeout(300);
  const typed = await emailBox.inputValue();
  log(`  email field value: ${typed || "(empty!)"}`);
  // Click the actual submit button by its text.
  await page.getByRole("button", { name: /sign in/i }).first().click().catch(async () => {
    await passBox.press("Enter");
  });
  await page.waitForURL(/\/cleaners/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "00-after-login.png") });
  const url = page.url();
  log(`  after login: ${url}`);
  if (!url.includes("/cleaners")) {
    log("✗ CLEANER LOGIN FAILED — see 00-after-login.png");
    await browser.close(); process.exit(2);
  }
  log("✓ cleaner logged in.");
  log("── CLEANER PAGES ──");
  let i = 1;
  for (const [name, route] of PAGES) await shot(i++, name, route);

  fs.writeFileSync(path.join(OUT, "_results.json"), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => r.flag !== "ok");
  log(`\n── SUMMARY ── ${results.length} pages, ${bad.length} flagged`);
  bad.forEach((r) => log(`  ⚠ ${r.name} (${r.route}) — ${r.flag} [${r.status}]`));
} finally {
  await browser.close();
}
