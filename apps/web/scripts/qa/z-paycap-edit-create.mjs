// ZZTEST scratch: build the fixture the per-cleaner pay cap's edit hole needs.
// $200 job, two cleaners, $70 + $50 typed into the payFor boxes.
import { open, signIn, BASE } from "./harness.mjs";

const NAME = process.env.ZZ_NAME ?? `ZZTEST paycap edit ${Date.now()}`;

const { browser, page, problems } = await open();
const out = { name: NAME, steps: [] };
const step = (k, v) => out.steps.push({ [k]: v });

try {
  try {
    await signIn(page, "admin");
  } catch {
    // Known harness quirk: the nav wait can time out after a successful login.
    for (let i = 0; i < 60 && /sign-in/.test(page.url()); i++) {
      await page.waitForTimeout(1000);
    }
  }
  step("landed", page.url());

  await page.goto(`${BASE}/admin/jobs/new`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="clientName"]');

  await page.fill('input[name="clientName"]', NAME);

  // Date: open the picker and take any enabled day cell.
  await page.click('button:has-text("Select date"), [aria-haspopup="dialog"]').catch(() => {});
  const dayBtn = page.locator('button').filter({ hasText: /^\d{1,2}$/ });
  await page.waitForTimeout(500);
  const n = await dayBtn.count();
  let picked = false;
  for (let i = 0; i < n; i++) {
    const b = dayBtn.nth(i);
    if (await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) {
      await b.click();
      picked = true;
      break;
    }
  }
  step("datePicked", picked);
  await page.fill('input[name="startTime"]', "10:00");

  await page.fill("#price", "200");

  // Two cleaners.
  for (const who of ["zztest-cleaner1", "zztest-cleaner2"]) {
    await page.fill("#cleaner-search", who);
    await page.waitForTimeout(800);
    await page.click(`button:has-text("${who}@cleano.test")`);
    await page.waitForTimeout(400);
  }

  const payBoxes = page.locator('input[name^="payFor_"]');
  await payBoxes.first().waitFor();
  step("payBoxes", await payBoxes.count());
  await payBoxes.nth(0).fill("70");
  await payBoxes.nth(1).fill("50");
  await page.waitForTimeout(800);

  step("startDateValue", await page.inputValue('input[name="startDate"]'));
  step("payNames", await payBoxes.evaluateAll((els) => els.map((e) => e.name)));
  step("payValues", await payBoxes.evaluateAll((els) => els.map((e) => e.value)));

  await page.click('button:has-text("Create Job")');
  await page.waitForURL((u) => /\/admin\/jobs(\?|$)/.test(u.pathname + u.search), {
    timeout: 240_000,
  });
  step("afterCreate", page.url());

  // Find the job we just made.
  await page.goto(`${BASE}/admin/jobs?q=${encodeURIComponent(NAME)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(3000);
  const href = await page
    .locator(`a[href^="/admin/jobs/"]`)
    .first()
    .getAttribute("href")
    .catch(() => null);
  step("firstJobHref", href);
} catch (e) {
  step("error", String(e).slice(0, 600));
} finally {
  console.log(JSON.stringify({ out, problems: problems.slice(0, 10) }, null, 1));
  await browser.close();
}
