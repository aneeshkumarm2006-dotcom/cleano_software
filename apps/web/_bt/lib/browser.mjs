// Shared Playwright harness. Every feature test imports from here so that
// login, waiting and evidence capture behave identically across agents —
// a failure then means the feature is broken, not that one agent wrote a
// flakier wait than another.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BT_DIR } from "./manifest.mjs";

export const SHOTS = join(BT_DIR, "shots");
mkdirSync(SHOTS, { recursive: true });

export function accounts() {
  const p = join(BT_DIR, "accounts.json");
  if (!existsSync(p)) throw new Error("accounts.json missing — run: node _bt/setup.mjs");
  return JSON.parse(readFileSync(p, "utf8"));
}

export const BASE = () => accounts().baseUrl;

/**
 * Launch a browser. headless by default; set BT_HEADED=1 to watch it.
 * A generous default timeout: this is a dev server compiling routes on first
 * hit, and a cold Turbopack compile of a heavy admin route genuinely can
 * exceed the Playwright default. A short timeout here would report
 * "feature broken" for what is only a slow first paint.
 */
export async function launch() {
  const browser = await chromium.launch({ headless: !process.env.BT_HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  ctx.setDefaultTimeout(60_000);
  ctx.setDefaultNavigationTimeout(90_000);
  return { browser, ctx };
}

/** Console errors and failed requests, collected for the report. */
export function watchErrors(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`http ${r.status()}: ${r.url().slice(0, 200)}`); });
  return errors;
}

/**
 * Sign in through the real UI, not by injecting a cookie — the login flow is
 * itself part of what must keep working, and a forged session would hide a
 * broken one. `which` is a key from accounts.json.
 */
export async function login(page, which) {
  const acct = accounts();
  const cred = acct.accounts[which];
  if (!cred) throw new Error(`unknown account '${which}'`);

  const loginPath = which === "customer" ? "/login" : "/sign-in";
  await page.goto(`${acct.baseUrl}${loginPath}`, { waitUntil: "domcontentloaded" });

  await page.locator('input[type="email"]').first().fill(cred.email);
  await page.locator('input[type="password"]').first().fill(cred.password);
  await page.getByRole("button", { name: /sign in/i }).first().click();

  // Landing route differs by role, so wait for "no longer on the login page"
  // rather than for one specific URL.
  await page.waitForFunction(
    (p) => !window.location.pathname.startsWith(p),
    loginPath,
    { timeout: 60_000 }
  ).catch(() => {});

  if (page.url().includes(loginPath)) {
    const banner = await page.locator(".cl-banner, [class*=banner]").first().textContent().catch(() => null);
    throw new Error(`login as ${which} did not leave ${loginPath}. Banner: ${banner ?? "(none)"}`);
  }
  return cred;
}

/** Screenshot into _bt/shots, returning the path for the report. */
export async function shot(page, name) {
  const file = join(SHOTS, `${name.replace(/[^a-z0-9._-]/gi, "_")}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Structured result written by each feature test, read by the orchestrator. */
export function writeResult(feature, result) {
  const dir = join(BT_DIR, "results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `feature-${feature}.json`), JSON.stringify(result, null, 2));
}

/** Tiny assertion helper that accumulates instead of throwing on first failure,
 *  so one test run reports every problem in a feature rather than just the first. */
export function checker() {
  const checks = [];
  return {
    check(label, passed, detail = "") {
      checks.push({ label, passed: Boolean(passed), detail: String(detail).slice(0, 500) });
      console.log(`${passed ? "PASS" : "FAIL"}  ${label}${passed || !detail ? "" : `  — ${detail}`}`);
      return Boolean(passed);
    },
    checks,
    get failed() { return checks.filter((c) => !c.passed); },
    get passed() { return checks.filter((c) => c.passed); },
  };
}
