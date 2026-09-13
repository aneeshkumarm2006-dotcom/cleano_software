// ZZTEST scratch: find the fixture job's id by clicking its row in the list.
import { open, signIn, BASE } from "./harness.mjs";

const NAME = process.env.ZZ_NAME ?? "ZZTEST paycap edit A";
const { browser, page, problems } = await open();
const out = [];

try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 60 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
  await page.goto(`${BASE}/admin/jobs`, { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="Search by client, address…"]', NAME);
  await page.waitForTimeout(4000);
  const row = page.locator("tr", { hasText: NAME }).first();
  await row.waitFor({ timeout: 60_000 });
  await row.click();
  await page.waitForURL(/\/admin\/jobs\/[a-z0-9]+/, { timeout: 120_000 });
  out.push({ jobUrl: page.url() });
} catch (e) {
  out.push({ error: String(e).slice(0, 500) });
} finally {
  console.log(JSON.stringify({ out, problems: problems.slice(0, 6) }, null, 1));
  await browser.close();
}
