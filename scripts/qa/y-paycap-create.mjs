// ZZTEST scratch: create a job on /admin/jobs/new.
//   ZZ_NAME   client name (also how we find it again)
//   ZZ_PRICE  price box
//   ZZ_PAYS   comma list for the payFor_ boxes, "" = leave every box blank
import { open, signIn, BASE } from "./harness.mjs";

const NAME = process.env.ZZ_NAME ?? `ZZTEST paycap ${Date.now()}`;
const PRICE = process.env.ZZ_PRICE ?? "200";
const PAYS = (process.env.ZZ_PAYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const { browser, page, problems } = await open();
const out = { name: NAME, price: PRICE, pays: PAYS, steps: [] };
const step = (k, v) => out.steps.push({ [k]: v });

async function loginAdmin() {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 90 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
}

try {
  await loginAdmin();
  step("landed", page.url());

  await page.goto(`${BASE}/admin/jobs/new`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name="clientName"]', { timeout: 120_000 });
  await page.fill('input[name="clientName"]', NAME);

  // Date picker: open it, click the first enabled day cell.
  await page.click('button:has-text("Select date"), [aria-haspopup="dialog"]').catch(() => {});
  await page.waitForTimeout(700);
  const dayBtn = page.locator("button").filter({ hasText: /^\d{1,2}$/ });
  const n = await dayBtn.count();
  let picked = false;
  for (let i = 0; i < n; i++) {
    const b = dayBtn.nth(i);
    if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) {
      await b.click();
      picked = true;
      break;
    }
  }
  step("datePicked", picked);
  await page.fill('input[name="startTime"]', "10:00");
  await page.fill("#price", PRICE);

  for (const who of ["zztest-cleaner1", "zztest-cleaner2"]) {
    await page.fill("#cleaner-search", who);
    await page.waitForTimeout(1200);
    await page.click(`button:has-text("${who}@cleano.test")`);
    await page.waitForTimeout(500);
  }

  const payBoxes = page.locator('input[name^="payFor_"]');
  await payBoxes.first().waitFor({ timeout: 60_000 });
  step("payBoxCount", await payBoxes.count());
  for (let i = 0; i < PAYS.length; i++) await payBoxes.nth(i).fill(PAYS[i]);
  await page.waitForTimeout(1200);

  step("startDate", await page.inputValue('input[name="startDate"]'));
  step("payNames", await payBoxes.evaluateAll((e) => e.map((x) => x.name)));
  step("payValues", await payBoxes.evaluateAll((e) => e.map((x) => x.value)));
  step("requiredCleaners", await page.inputValue("#requiredCleaners").catch(() => "(absent)"));
  step(
    "alerts",
    await page.locator('[role="alert"]').evaluateAll((e) =>
      e.map((x) => x.innerText.replace(/\s+/g, " ").slice(0, 220))
    )
  );

  await page.click('button:has-text("Create Job")');
  await page.waitForURL((u) => /\/admin\/jobs(\?|$)/.test(u.pathname + u.search), {
    timeout: 300_000,
  });
  step("afterCreate", page.url());

  // Find it again by name.
  await page.goto(`${BASE}/admin/jobs?search=${encodeURIComponent(NAME)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(6000);
  const hrefs = await page
    .locator('a[href^="/admin/jobs/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const ids = [...new Set(hrefs.filter((h) => /^\/admin\/jobs\/c[a-z0-9]{20,}$/.test(h)))];
  step("jobIds", ids);
  out.jobId = ids[0] ?? null;
} catch (e) {
  step("error", String(e).slice(0, 800));
} finally {
  console.log("RESULT " + JSON.stringify({ out, problems: problems.slice(0, 8) }, null, 1));
  await browser.close();
}
