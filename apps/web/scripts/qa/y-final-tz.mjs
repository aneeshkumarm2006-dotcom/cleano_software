/* Final verification — does the admin calendar show the STORE day/clock? Scratch. */
import { open, signIn, visit, report, BASE } from "./harness.mjs";

const parts = (tz) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );

const out = [];
const { browser, page, problems } = await open();

try {
  try {
    await signIn(page, "admin");
  } catch {
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(2000);
      if (!/\/sign-in$/.test(new URL(page.url()).pathname)) break;
    }
  }

  // Month grid: which cell is ringed as "today".
  await visit(page, "/admin/calendar?view=month");
  await page.waitForSelector(".cal-mcell", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const monthToday = await page.locator(".cal-mcell.today .cal-mdate").allInnerTexts();
  const monthHeader = await page
    .locator("header, h1, h2, .cal-toolbar, [class*='toolbar']")
    .allInnerTexts()
    .catch(() => []);

  // Day grid: where the red now-line sits relative to the hour labels.
  await visit(page, "/admin/calendar?view=day");
  await page.waitForTimeout(6000);
  const probe = await page.evaluate(() => {
    const line = document.querySelector(".z-50.pointer-events-none");
    const lineTop = line ? parseFloat(getComputedStyle(line).top) : null;
    const container = line?.parentElement ?? null;
    // Hour labels down the left gutter, with their y offsets.
    const labels = Array.from(document.querySelectorAll("*"))
      .filter((el) => /^\d{1,2}\s?(AM|PM)$/i.test((el.textContent || "").trim()) && el.children.length === 0)
      .slice(0, 30)
      .map((el) => ({ text: el.textContent.trim(), top: el.getBoundingClientRect().top }));
    return {
      lineFound: Boolean(line),
      lineTopPx: lineTop,
      lineViewportY: line ? line.getBoundingClientRect().top : null,
      containerY: container ? container.getBoundingClientRect().top : null,
      hourLabels: labels,
    };
  });

  const mtl = parts("America/Montreal");
  const local = parts(Intl.DateTimeFormat().resolvedOptions().timeZone);
  out.push({
    surface: "calendar store-day / store-clock",
    storeNow: `${mtl.year}-${mtl.month}-${mtl.day} ${mtl.hour}:${mtl.minute} America/Montreal`,
    machineNow: `${local.year}-${local.month}-${local.day} ${local.hour}:${local.minute} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    monthTodayCellDayNumber: monthToday,
    expectedStoreDayNumber: String(Number(mtl.day)),
    machineDayNumber: String(Number(local.day)),
    monthHeader: monthHeader.slice(0, 4).map((t) => t.replace(/\s+/g, " ").slice(0, 90)),
    dayView: probe,
  });
} finally {
  report("FINAL-TZ", out, problems);
  await browser.close();
}
