/**
 * Shared browser harness for the QA sweep.
 *
 * Each test script launches its OWN chromium through this, so many agents can
 * click through the app at the same time without fighting over one shared
 * browser. That is the whole reason this exists.
 *
 * LOCALHOST ONLY. It refuses any other base, because a harness that presses
 * buttons must never be pointed at a host serving real customers.
 */
import { chromium } from "playwright";

export const BASE = process.env.QA_BASE ?? "http://zztestqa.localhost:3006";

if (!/^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing to drive ${BASE} — localhost only`);
}

export const ACCOUNTS = {
  admin: { email: "zztest-owner@cleano.test", password: "QaTesting2026!", door: "/sign-in" },
  cleaner1: { email: "zztest-cleaner1@cleano.test", password: "QaTesting2026!", door: "/cleanos/login" },
  cleaner2: { email: "zztest-cleaner2@cleano.test", password: "QaTesting2026!", door: "/cleanos/login" },
};

/** Problems a page reported to the console or the network, collected as we go. */
export function watch(page, sink) {
  page.on("console", (m) => {
    if (m.type() === "error") sink.push({ kind: "console", detail: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => sink.push({ kind: "pageerror", detail: String(e).slice(0, 400) }));
  page.on("response", (r) => {
    if (r.status() >= 500) sink.push({ kind: "http", detail: `${r.status()} ${r.url()}` });
  });
}

export async function open({ headless = true, viewport } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext(
    viewport ? { viewport } : { viewport: { width: 1440, height: 900 } },
  );
  // This machine is far from the database; every navigation is slow.
  context.setDefaultTimeout(120_000);
  context.setDefaultNavigationTimeout(120_000);
  const page = await context.newPage();
  const problems = [];
  watch(page, problems);
  return { browser, context, page, problems };
}

/**
 * Sign in at the door that matches the role. Returns the path we landed on.
 *
 * The app routes through /api/post-signin, which is slow here, so this waits on
 * the URL settling rather than on any one selector.
 */
export async function signIn(page, who) {
  const acct = ACCOUNTS[who];
  if (!acct) throw new Error(`unknown account ${who}`);

  await page.goto(`${BASE}${acct.door}`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', acct.email);
  await page.fill('input[type="password"], input[name="password"]', acct.password);
  await Promise.all([
    page.waitForURL((u) => !/\/(sign-in|cleanos\/login)(\?|$)/.test(u.pathname + u.search), {
      timeout: 180_000,
    }),
    page.click('button[type="submit"], button:has-text("Sign in")'),
  ]);
  await page.waitForLoadState("domcontentloaded");
  return new URL(page.url()).pathname;
}

/** Go somewhere and report whether it actually rendered. */
export async function visit(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const body = await page.innerText("body").catch(() => "");
  return {
    path,
    status: res?.status() ?? 0,
    url: page.url(),
    // Next renders its error boundary as visible text, so this is a real signal.
    errorBoundary: /Application error|Unhandled Runtime Error|something went wrong/i.test(body),
    text: body.slice(0, 4000),
  };
}

export function report(name, entries, problems) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(entries, null, 1));
  if (problems.length) {
    console.log(`----- problems (${problems.length}) -----`);
    console.log(JSON.stringify(problems.slice(0, 40), null, 1));
  } else {
    console.log("----- no console/pageerror/5xx captured -----");
  }
}
