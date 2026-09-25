// ZZTEST scratch: open /admin/jobs/new?edit=<id> and report what the form shows.
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
if (!JOB) throw new Error("set ZZ_JOB");

const { browser, page, problems } = await open();
const out = {};
try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 90 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
  await page.goto(`${BASE}/admin/jobs/new?edit=${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="clientName"]', { timeout: 180_000 });
  await page.waitForTimeout(2500);

  const boxes = page.locator('input[name^="payFor_"]');
  out.clientName = await page.inputValue('input[name="clientName"]');
  out.price = await page.inputValue("#price");
  out.employeePay = await page.inputValue("#employeePay");
  out.requiredCleaners = await page.inputValue("#requiredCleaners").catch(() => "(absent)");
  out.payBoxes = await boxes.evaluateAll((els) =>
    els.map((e) => ({ name: e.name, value: e.value, invalid: e.getAttribute("aria-invalid") }))
  );
  out.validationMessages = await boxes.evaluateAll((els) =>
    els.map((e) => e.validationMessage)
  );
  out.alerts = await page
    .locator('[role="alert"]')
    .evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").slice(0, 300)));
  out.bodyHasRedPanel = /Custom pay adds up to/.test(await page.innerText("body"));
} catch (e) {
  out.error = String(e).slice(0, 800);
} finally {
  console.log("RESULT " + JSON.stringify({ out, problems: problems.slice(0, 8) }, null, 1));
  await browser.close();
}
