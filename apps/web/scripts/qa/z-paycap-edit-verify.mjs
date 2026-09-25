// ZZTEST scratch: the edit form's per-cleaner pay cap.
//
//  A  the boxes prefill from the stored JobAssignment.payAmount rows
//  B  dropping the price under those stored payouts is refused (client)
//  C  the same drop with the boxes CLEARED ("leave as-is") is refused (server)
//  D  a plain edit that changes nothing still saves
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
const ONLY = process.env.ZZ_ONLY ?? "ABCD";
if (!JOB) throw new Error("set ZZ_JOB");

const { browser, page, problems } = await open();
const out = [];
const step = (k, v) => out.push({ [k]: v });

const openEdit = async () => {
  await page.goto(`${BASE}/admin/jobs/new?edit=${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name^="payFor_"]', { timeout: 120_000 });
  await page.waitForTimeout(1500);
};
const payValues = () =>
  page.locator('input[name^="payFor_"]').evaluateAll((els) => els.map((e) => e.value));
const alertText = async () => {
  const a = page.locator('[role="alert"]');
  const c = await a.count();
  const t = [];
  for (let i = 0; i < c; i++) t.push((await a.nth(i).innerText()).replace(/\s+/g, " ").slice(0, 300));
  return t;
};
const blocked = () =>
  page.locator('input[name^="payFor_"]').evaluateAll((els) =>
    els.map((e) => ({ msg: e.validationMessage, valid: e.checkValidity() }))
  );

try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 60 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }

  if (ONLY.includes("A")) {
    await openEdit();
    step("A_prefilledBoxes", await payValues());
    step("A_price", await page.inputValue("#price"));
    step("A_alertsOnLoad", await alertText());
    step("A_validityOnLoad", await blocked());
  }

  if (ONLY.includes("B")) {
    await openEdit();
    await page.fill("#price", "100");
    await page.waitForTimeout(1500);
    step("B_alerts", await alertText());
    step("B_validity", await blocked());
    await page.click('button:has-text("Update Job")');
    await page.waitForTimeout(6000);
    step("B_urlAfterClick", page.url());
  }

  if (ONLY.includes("C")) {
    await openEdit();
    // Clear both boxes — the old "blank means leave as-is" post that used to
    // slip past the cap entirely.
    const boxes = page.locator('input[name^="payFor_"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) await boxes.nth(i).fill("");
    await page.fill("#price", "100");
    await page.waitForTimeout(1500);
    step("C_boxes", await payValues());
    step("C_alerts", await alertText());
    step("C_validity", await blocked());
    await page.click('button:has-text("Update Job")');
    await page.waitForTimeout(20_000);
    const body = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
    step("C_urlAfterSubmit", page.url());
    step("C_serverError", /adds up to|Application error|error/i.test(body) ? body.slice(0, 500) : "(none)");
  }

  if (ONLY.includes("D")) {
    await openEdit();
    step("D_boxesBefore", await payValues());
    step("D_priceBefore", await page.inputValue("#price"));
    step("D_validity", await blocked());
    await page.click('button:has-text("Update Job")');
    await page
      .waitForURL((u) => !/jobs\/new/.test(u.pathname + u.search), { timeout: 240_000 })
      .catch(() => {});
    step("D_urlAfterSave", page.url());
    // And the stored overrides survived untouched.
    await openEdit();
    step("D_boxesAfter", await payValues());
    step("D_priceAfter", await page.inputValue("#price"));
  }
} catch (e) {
  step("error", String(e).slice(0, 700));
} finally {
  console.log(JSON.stringify({ out, problems: problems.slice(0, 10) }, null, 1));
  await browser.close();
}
