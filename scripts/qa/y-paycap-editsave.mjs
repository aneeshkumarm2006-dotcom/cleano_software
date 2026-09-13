// ZZTEST scratch: open an edit form, optionally touch ONE harmless field, save.
//   ZZ_JOB   job id
//   ZZ_NOTE  if set, typed into #notes before saving; otherwise nothing is touched
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
const NOTE = process.env.ZZ_NOTE ?? "";
if (!JOB) throw new Error("set ZZ_JOB");

const { browser, page, problems } = await open();
const out = { job: JOB, note: NOTE };
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
  out.before = {
    price: await page.inputValue("#price"),
    pay: await boxes.evaluateAll((e) => e.map((x) => `${x.name}=${x.value}`)),
    validity: await page.evaluate(() => document.querySelector("form").checkValidity()),
    alerts: await page
      .locator('[role="alert"]')
      .evaluateAll((e) => e.map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 300))),
  };

  if (NOTE) await page.fill("#notes", NOTE);
  await page.waitForTimeout(800);

  await page.click('button:has-text("Update Job")');
  let landed = page.url();
  for (let i = 0; i < 260; i++) {
    await page.waitForTimeout(1000);
    landed = page.url();
    if (!/\/admin\/jobs\/new/.test(new URL(landed).pathname + new URL(landed).search)) break;
  }
  out.urlAfterSubmit = landed;
  out.savedAndRedirected = new URL(landed).pathname === `/admin/jobs/${JOB}`;
  const body = await page.innerText("body").catch(() => "");
  out.errorBoundary = /Application error|server-side exception/i.test(body);
} catch (e) {
  out.error = String(e).slice(0, 800);
} finally {
  console.log("RESULT " + JSON.stringify({ out, problems: problems.slice(0, 10) }, null, 1));
  await browser.close();
}
