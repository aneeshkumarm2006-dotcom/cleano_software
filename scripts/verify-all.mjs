// COMPREHENSIVE read-only visual sweep: every admin page + detail sub-page,
// plus all public/booking pages. Navigation + screenshot only — never clicks
// charge/send/delete/save. Real detail-page IDs are passed in via env.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "https://www.useawer.com";
const OUT = path.join(process.cwd(), "scripts", "shots-all");
fs.mkdirSync(OUT, { recursive: true });

const envRaw = fs.readFileSync(path.join(process.cwd(), ".env.e2e"), "utf8");
const env = Object.fromEntries(
  envRaw.split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const EMAIL = env.E2E_EMAIL, PASSWORD = env.E2E_PASSWORD;

// Real IDs (fetched from DB) for detail pages.
const ID = {
  JOB: "cmrjqzdut0001i00a9sdexf9y",
  CLIENT: "cmnzvzoig0000tvccpcp3wfjp",
  EMPLOYEE: "cmq8cv9m90005ic04kpjgac90",
  PRODUCT: "cmpf21zn10001ie04nhp1bhby",
  INVOICE: "cmov0nu280001l804jjvcsi7b",
  CONTACT: "2ee87796-64c8-41ab-abb6-8ffc84cdf7df",
  TRAINING: "cmpedbj1s0004ju04rnuykezl",
};

// PUBLIC pages (no login needed).
const PUBLIC = [
  ["pub-home", "/"],
  ["pub-book", "/book"],
  ["pub-careers", "/careers"],
  ["pub-faq", "/faq"],
  ["pub-quote", "/quote"],
  ["pub-reviews", "/reviews"],
  ["pub-gift-card", "/gift-card"],
  ["pub-join-waitlist", "/join-waitlist"],
  ["pub-sign-in", "/sign-in"],
  ["pub-login", "/login"],
  ["pub-cleanos-login", "/cleanos/login"],
  ["pub-forgot-password", "/forgot-password"],
];

// ADMIN pages (need admin login). Detail pages use real IDs.
const ADMIN = [
  ["dashboard", "/admin/dashboard"],
  ["analytics", "/admin/analytics"],
  ["kpi", "/admin/kpi"],
  ["calendar", "/admin/calendar"],
  ["contacts", "/admin/contacts"],
  ["contacts-detail", `/admin/contacts/${ID.CONTACT}`],
  ["contacts-duplicates", "/admin/contacts/duplicates"],
  ["jobs", "/admin/jobs"],
  ["jobs-detail", `/admin/jobs/${ID.JOB}`],
  ["jobs-new", "/admin/jobs/new"],
  ["requests", "/admin/requests"],
  ["waitlist", "/admin/waitlist"],
  ["documents", "/admin/documents"],
  ["clients", "/admin/clients"],
  ["clients-detail", `/admin/clients/${ID.CLIENT}`],
  ["web-bookings", "/admin/web-bookings"],
  ["leads", "/admin/leads"],
  ["chat", "/admin/chat"],
  ["employees", "/admin/employees"],
  ["employees-detail", `/admin/employees/${ID.EMPLOYEE}`],
  ["job-applications", "/admin/job-applications"],
  ["training-docs", "/admin/training-docs"],
  ["training", "/admin/training"],
  ["training-detail", `/admin/training/${ID.TRAINING}`],
  ["announcements", "/admin/announcements"],
  ["group-chat", "/admin/group-chat"],
  ["inventory", "/admin/inventory"],
  ["inventory-detail", `/admin/inventory/${ID.PRODUCT}`],
  ["inventory-kits", "/admin/inventory/kits"],
  ["inventory-ragwash", "/admin/inventory/rag-wash"],
  ["sales", "/admin/sales"],
  ["reports", "/admin/reports"],
  ["quotes", "/admin/quotes"],
  ["gift-cards", "/admin/gift-cards"],
  ["promo-codes", "/admin/promo-codes"],
  ["payouts", "/admin/payouts"],
  ["wash-payouts", "/admin/wash-payouts"],
  ["finances", "/admin/finances"],
  ["invoices", "/admin/invoices"],
  ["invoices-detail", `/admin/invoices/${ID.INVOICE}`],
  ["bulk-charge", "/admin/bulk-charge"],
  ["recurring", "/admin/recurring"],
  ["properties", "/admin/properties"],
  ["logs", "/admin/logs"],
  ["settings", "/admin/settings"],
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
    // Detect an error/blank: look for common error text.
    const body = (await page.textContent("body").catch(() => "")) || "";
    const err = /something went wrong|application error|500|this page could|not found|unexpected error/i.test(body.slice(0, 400));
    await page.screenshot({ path: path.join(OUT, `${n}-${name}.png`) });
    const flag = err ? "⚠ possible error text" : (url.includes("/sign-in") && !route.includes("sign-in") ? "⚠ bounced to sign-in" : "ok");
    results.push({ name, route, status, flag });
    log(`  ${flag === "ok" ? "✓" : "⚠"} ${name}  [HTTP ${status}] ${flag === "ok" ? "" : flag}`);
  } catch (e) {
    results.push({ name, route, status: "ERR", flag: e.message.split("\n")[0] });
    log(`  ✗ ${name}: ${e.message.split("\n")[0]}`);
  }
}

try {
  // Public pages first (no auth).
  log("── PUBLIC PAGES ──");
  let i = 0;
  for (const [name, route] of PUBLIC) await shot(i++, name, route);

  // Login.
  log("── LOGIN ──");
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.fill('input[type="email"], input[name="email"]', EMAIL).catch(() => {});
  await page.fill('input[type="password"], input[name="password"]', PASSWORD).catch(() => {});
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/admin/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  if (!page.url().includes("/admin")) { log("✗ LOGIN FAILED — stopping admin sweep."); }
  else {
    log("✓ logged in.");
    log("── ADMIN PAGES ──");
    for (const [name, route] of ADMIN) await shot(i++, name, route);
  }

  fs.writeFileSync(path.join(OUT, "_results.json"), JSON.stringify(results, null, 2));
  const bad = results.filter((r) => r.flag !== "ok");
  log(`\n── SUMMARY ── ${results.length} pages, ${bad.length} flagged`);
  bad.forEach((r) => log(`  ⚠ ${r.name} (${r.route}) — ${r.flag} [${r.status}]`));
} finally {
  await browser.close();
}
