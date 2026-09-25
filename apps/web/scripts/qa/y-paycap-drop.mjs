// ZZTEST scratch: on an edit, change the Price box and try to save.
//   ZZ_JOB     job id
//   ZZ_PRICE   new price to type
//   ZZ_BYPASS  "1" = turn off the browser's constraint validation first, so the
//              submit reaches the server and we see the server-side backstop.
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
const PRICE = process.env.ZZ_PRICE ?? "100";
const BYPASS = process.env.ZZ_BYPASS === "1";
if (!JOB) throw new Error("set ZZ_JOB");

const { browser, page, problems } = await open();
const out = { job: JOB, price: PRICE, bypass: BYPASS };
try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 90 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
  await page.goto(`${BASE}/admin/jobs/new?edit=${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name^="payFor_"]', { timeout: 180_000 });
  await page.waitForTimeout(2000);

  out.before = {
    price: await page.inputValue("#price"),
    pay: await page.locator('input[name^="payFor_"]').evaluateAll((e) => e.map((x) => x.value)),
  };

  await page.fill("#price", PRICE);
  // The cap re-reads the money fields on a 500ms tick.
  await page.waitForTimeout(2500);

  const boxes = page.locator('input[name^="payFor_"]');
  out.afterTyping = {
    validationMessages: await boxes.evaluateAll((e) => e.map((x) => x.validationMessage)),
    ariaInvalid: await boxes.evaluateAll((e) => e.map((x) => x.getAttribute("aria-invalid"))),
    alerts: await page
      .locator('[role="alert"]')
      .evaluateAll((e) => e.map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 320))),
    formValid: await page.evaluate(() => document.querySelector("form").checkValidity()),
  };

  if (BYPASS) {
    await page.evaluate(() => {
      document.querySelector("form").noValidate = true;
    });
    out.bypassApplied = true;
  }

  const urlBefore = page.url();
  await page.click('button:has-text("Update Job")');
  // Give it a long time: a real save on this box takes 15s-4min.
  let landed = urlBefore;
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(1000);
    landed = page.url();
    if (!/\/admin\/jobs\/new/.test(new URL(landed).pathname + new URL(landed).search)) break;
    const body = await page.innerText("body").catch(() => "");
    if (/Application error|Unhandled Runtime Error|adds up to/i.test(body) && i > 20) {
      // server-thrown error boundary, or still sitting on the form
    }
  }
  out.urlAfterSubmit = landed;
  out.stillOnForm = /\/admin\/jobs\/new/.test(new URL(landed).pathname);
  const body = await page.innerText("body").catch(() => "");
  out.errorBoundary = /Application error|Unhandled Runtime Error|server-side exception/i.test(body);
  out.bodyHead = body.replace(/\s+/g, " ").slice(0, 400);
} catch (e) {
  out.error = String(e).slice(0, 800);
} finally {
  console.log("RESULT " + JSON.stringify({ out, problems: problems.slice(0, 10) }, null, 1));
  await browser.close();
}
