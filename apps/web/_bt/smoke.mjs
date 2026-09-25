// Proves the harness itself works before 20 feature agents depend on it.
// If login is broken, every downstream agent reports "feature broken" for
// what is really one bad selector here — so this runs first, alone.
import { launch, login, shot, watchErrors, checker, BASE } from "./lib/browser.mjs";

const c = checker();
const { browser, ctx } = await launch();

for (const [role, landing] of [["admin", "/admin"], ["cleaner", "/cleaners"], ["customer", "/account"]]) {
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  try {
    await login(page, role);
    c.check(`${role}: login succeeds`, true, page.url());

    await page.goto(`${BASE()}${landing}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const url = page.url();
    const stayed = !/\/sign-in|\/login/.test(url);
    c.check(`${role}: reaches ${landing}`, stayed, url);
    await shot(page, `smoke-${role}`);

    const fatal = errs.filter((e) => e.startsWith("http 5") || e.startsWith("pageerror"));
    c.check(`${role}: no fatal errors`, fatal.length === 0, fatal.slice(0, 3).join(" | "));
  } catch (e) {
    c.check(`${role}: login succeeds`, false, e.message);
  }
  await page.close();
}

await browser.close();
console.log(`\n${c.passed.length} passed, ${c.failed.length} failed`);
process.exitCode = c.failed.length ? 1 : 0;
