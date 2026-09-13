// ZZTEST scratch: read back what a job actually stores, through its edit form.
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
if (!JOB) throw new Error("set ZZ_JOB");
const { browser, page, problems } = await open();
const out = [];

try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 60 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
  await page.goto(`${BASE}/admin/jobs/new?edit=${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name^="payFor_"]', { timeout: 120_000 });
  await page.waitForTimeout(1500);
  out.push({
    price: await page.inputValue("#price"),
    employeePay: await page.inputValue("#employeePay"),
    pay: await page
      .locator('input[name^="payFor_"]')
      .evaluateAll((els) => els.map((e) => `${e.name}=${e.value}`)),
    alerts: await page
      .locator('[role="alert"]')
      .evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").slice(0, 260))),
  });
} catch (e) {
  out.push({ error: String(e).slice(0, 500) });
} finally {
  console.log(JSON.stringify({ out, problems: problems.slice(0, 6) }, null, 1));
  await browser.close();
}
