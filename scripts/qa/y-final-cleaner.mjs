/* Final verification sweep — cleaner surfaces. Scratch; delete after. */
import { open, signIn, visit, report, BASE } from "./harness.mjs";

const out = [];
const { browser, page, problems } = await open();

try {
  let landed = null;
  const s0 = Date.now();
  try {
    landed = await signIn(page, "cleaner1");
  } catch (e) {
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      const u = new URL(page.url());
      if (!/\/(sign-in|cleanos\/login)$/.test(u.pathname)) { landed = u.pathname; break; }
    }
    out.push({ surface: "signIn(cleaner1) quirk", note: String(e).slice(0, 160), landed });
  }
  out.push({ surface: "cleaner signIn @ /cleanos/login", landed, ms: Date.now() - s0 });

  // my-jobs first, so we can pick a real job id off it.
  const my = await visit(page, "/cleaners/my-jobs");
  const jobHrefs = await page
    .locator('a[href*="/cleaners/my-jobs/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")).filter(Boolean).slice(0, 5))
    .catch(() => []);
  out.push({
    surface: "/cleaners/my-jobs",
    status: my.status,
    url: my.url,
    errorBoundary: my.errorBoundary,
    jobLinks: jobHrefs,
    text: my.text.replace(/\s+/g, " ").slice(0, 400),
  });

  const detail = jobHrefs[0];
  if (detail) {
    const started = Date.now();
    const r = await visit(page, detail.startsWith("http") ? new URL(detail).pathname : detail);
    out.push({
      surface: `job detail ${detail}`,
      status: r.status,
      url: r.url,
      errorBoundary: r.errorBoundary,
      ms: Date.now() - started,
      text: r.text.replace(/\s+/g, " ").slice(0, 600),
    });
  } else {
    out.push({ surface: "job detail", note: "NO JOB LINK FOUND on /cleaners/my-jobs" });
  }

  for (const p of [
    "/cleaners/my-pay",
    "/cleaners/dashboard",
    "/cleaners/announcements",
    "/cleaners/available-jobs",
  ]) {
    const started = Date.now();
    const r = await visit(page, p);
    out.push({
      surface: p,
      status: r.status,
      url: r.url,
      errorBoundary: r.errorBoundary,
      ms: Date.now() - started,
      text: r.text.replace(/\s+/g, " ").slice(0, 400),
    });
  }
} finally {
  report("FINAL-CLEANER", out, problems);
  await browser.close();
}
