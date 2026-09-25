// ZZTEST scratch: on an edit, retype the per-cleaner pay boxes and try to save.
//   ZZ_JOB      job id
//   ZZ_SETPAY   comma list, one entry per box, "-" means leave the box as it is,
//               "" (empty between commas) means CLEAR the box.
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
const SET = (process.env.ZZ_SETPAY ?? "").split(",");
if (!JOB) throw new Error("set ZZ_JOB");

const { browser, page, problems } = await open();
const out = { job: JOB, set: SET };
try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 90 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
  await page.goto(`${BASE}/admin/jobs/new?edit=${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name^="payFor_"]', { timeout: 180_000 });
  await page.waitForTimeout(2500);

  const boxes = page.locator('input[name^="payFor_"]');
  out.before = await boxes.evaluateAll((e) => e.map((x) => x.value));
  out.price = await page.inputValue("#price");

  for (let i = 0; i < SET.length && i < (await boxes.count()); i++) {
    if (SET[i] === "-") continue;
    await boxes.nth(i).fill(SET[i]);
  }
  await page.waitForTimeout(2500);

  out.after = {
    values: await boxes.evaluateAll((e) => e.map((x) => x.value)),
    validationMessages: await boxes.evaluateAll((e) => e.map((x) => x.validationMessage)),
    formValid: await page.evaluate(() => document.querySelector("form").checkValidity()),
    alerts: await page
      .locator('[role="alert"]')
      .evaluateAll((e) => e.map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 320))),
  };

  await page.click('button:has-text("Update Job")');
  let landed = page.url();
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(1000);
    landed = page.url();
    if (!/\/admin\/jobs\/new/.test(new URL(landed).pathname)) break;
    const b = await page.innerText("body").catch(() => "");
    if (/server-side exception/i.test(b)) break;
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
