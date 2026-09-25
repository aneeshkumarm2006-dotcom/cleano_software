// ZZTEST scratch: the SERVER half of the edit-form pay cap.
// Clears both payFor boxes ("leave as-is" — the post that used to slip past),
// drops the price under the stored payouts, submits, and reads the server
// action's own response body.
import { open, signIn, BASE } from "./harness.mjs";

const JOB = process.env.ZZ_JOB;
const PRICE = process.env.ZZ_PRICE ?? "100";
if (!JOB) throw new Error("set ZZ_JOB");

const { browser, page, problems } = await open();
const out = [];
const bodies = [];

page.on("response", async (r) => {
  if (r.request().method() !== "POST") return;
  if (!r.url().includes("/admin/jobs/new")) return;
  const t = await r.text().catch((e) => `<<unreadable ${e}>>`);
  const m = t.match(/Custom cleaner pay adds up to[^"\\]*/);
  bodies.push({
    status: r.status(),
    len: t.length,
    capMessage: m ? m[0] : null,
    sample: t.slice(0, 300),
  });
});

try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 60 && /sign-in/.test(page.url()); i++) await page.waitForTimeout(1000);
  }
  await page.goto(`${BASE}/admin/jobs/new?edit=${JOB}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[name^="payFor_"]', { timeout: 120_000 });
  await page.waitForTimeout(1500);

  const boxes = page.locator('input[name^="payFor_"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).fill("");
  await page.fill("#price", PRICE);
  await page.waitForTimeout(1500);

  out.push({
    boxesCleared: await boxes.evaluateAll((els) => els.map((e) => e.value)),
    priceTyped: await page.inputValue("#price"),
    clientBlocked: await boxes.evaluateAll((els) => els.some((e) => !e.checkValidity())),
  });

  await page.click('button:has-text("Update Job")');
  await page
    .waitForURL((u) => /\/admin\/jobs\/[a-z0-9]+$/.test(u.pathname), { timeout: 90_000 })
    .catch(() => {});
  await page.waitForTimeout(5000);
  const overlay = await page
    .evaluate(() => {
      const p = document.querySelector("nextjs-portal");
      const root = p?.shadowRoot;
      return root ? root.textContent.replace(/\s+/g, " ").slice(0, 600) : null;
    })
    .catch(() => null);
  out.push({ urlAfterSubmit: page.url(), overlay, serverBodies: bodies });
} catch (e) {
  out.push({ error: String(e).slice(0, 500) });
} finally {
  console.log(JSON.stringify({ out, problems: problems.slice(0, 8) }, null, 1));
  await browser.close();
}
