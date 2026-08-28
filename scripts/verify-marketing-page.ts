/**
 * The front page, checked in a real browser.
 *
 *   npm run dev
 *   npx tsx scripts/verify-marketing-page.ts
 *   MK_BASE=http://localhost:3100 npx tsx scripts/verify-marketing-page.ts
 *
 * WHY THIS EXISTS
 * /welcome is the only page a stranger sees before they decide whether to trust
 * us with their company, and it is the one page nobody signs in to — so nothing
 * else in the sweep touches it. Everything it can get wrong is invisible to a
 * type checker: a colour that does not have the contrast it needs, a link that
 * is too small to hit on a phone, a section that never becomes visible because
 * its reveal never fired, a price that has drifted away from what we actually
 * charge.
 *
 * It needs a RUNNING SERVER, because half of what it measures only exists once
 * the CSS has been resolved against a real viewport. In the default `npm run
 * verify` sweep there is not one, so it says so and stands down rather than
 * colouring the sweep red for a reason that has nothing to do with the code.
 *
 * LOCALHOST ONLY. It resizes windows and reads computed styles; there is no
 * reason to ever point it at production, and one good reason not to.
 */
import { chromium, type Page } from "playwright";

import { PLANS, TRIAL_DAYS } from "@/lib/plans";

const BASE = process.env.MK_BASE ?? "http://localhost:3000";
const URL_ = `${BASE.replace(/\/$/, "")}/welcome`;

if (!/^https?:\/\/([a-z0-9-]+\.)?localhost(:\d+)?$/.test(BASE)) {
  throw new Error(`refusing to drive ${BASE} — localhost only`);
}

let pass = 0;
let fail = 0;
const ok = (m: string) => {
  pass++;
  console.log(`  PASS  ${m}`);
};
const bad = (m: string, detail?: string) => {
  fail++;
  console.log(`  FAIL  ${m}${detail ? `\n        ${detail}` : ""}`);
};

/**
 * Contrast, measured the way a browser paints it.
 *
 * Every colour on this page is either translucent or sitting on a translucent
 * surface — a chip at 15% white over a row at 4.5% white over the board — so a
 * ratio computed from the declared values is a ratio of colours nobody sees.
 * This walks up the tree compositing each background in turn, which is the only
 * way the numbers mean anything.
 */
/**
 * The contrast probe, as source text rather than as a function.
 *
 * tsx compiles this file with esbuild's keepNames, which wraps every named
 * function — including `const f = () => {}` — in a `__name(...)` helper that
 * exists in Node and not in a browser page. Hand Playwright such a function and
 * it serialises into the page and dies on `__name is not defined`. A string is
 * evaluated as a plain expression and never passes through the compiler, so it
 * is the one form that cannot break this way.
 *
 * What it measures: every colour on this page is either translucent or sitting
 * on a translucent surface — a chip at 15% white, over a row at 4.5% white,
 * over the board — so a ratio computed from the declared values is a ratio of
 * colours nobody sees. This composites each background in turn, up the tree.
 */
function contrastProbe(selectors: string[]): string {
  return `(function () {
  var sels = ${JSON.stringify(selectors)};
  function nums(c) {
    var inner = c.slice(c.indexOf("(") + 1, c.lastIndexOf(")"));
    return inner
      .split(",").join(" ")
      .split("/").join(" ")
      .split(" ")
      .filter(function (x) { return x.length; })
      .map(Number);
  }
  function rgb(c) { var n = nums(c); return [n[0] || 0, n[1] || 0, n[2] || 0]; }
  function alpha(c) { var n = nums(c); return n.length > 3 ? n[3] : 1; }
  function lum(c) {
    var v = c.map(function (x) {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function over(fg, a, bg) { return fg.map(function (v, i) { return v * a + bg[i] * (1 - a); }); }
  function bgOf(el) {
    var n = el, acc = [255, 255, 255], stack = [];
    while (n && n !== document.documentElement) {
      var c = getComputedStyle(n).backgroundColor;
      var a = alpha(c);
      if (a > 0) stack.push([rgb(c), a]);
      n = n.parentElement;
    }
    for (var i = stack.length - 1; i >= 0; i--) acc = over(stack[i][0], stack[i][1], acc);
    return acc;
  }
  var out = {};
  for (var j = 0; j < sels.length; j++) {
    var sel = sels[j];
    var el = document.querySelector(sel);
    if (!el) { out[sel] = { missing: true }; continue; }
    var cs = getComputedStyle(el);
    var bg = bgOf(el);
    var fg = over(rgb(cs.color), alpha(cs.color), bg);
    var l1 = lum(fg), l2 = lum(bg);
    var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    var size = parseFloat(cs.fontSize);
    var large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    out[sel] = { ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5, size: size };
  }
  return out;
})()`;
}

/** Every piece of text small enough that WCAG asks for the full 4.5:1. */
const TEXT = [
  ".mk-lead",
  ".mk-eyebrow",
  ".mk-trust",
  ".mk-checks li",
  ".mk-stage-body p",
  ".mk-stage-num",
  ".mk-also-label",
  ".mk-also-grid li > span:last-child",
  ".mk-door-body",
  ".mk-door-path span",
  ".mk-plan-cap",
  ".mk-plan-note",
  ".mk-plans-foot",
  ".mk-q > p",
  ".mk-nav-links a",
  ".mk-foot a",
  // On the dark board, where a muted tone is easiest to get wrong.
  ".mk-url",
  ".mk-row-time",
  ".mk-row-main span",
  ".mk-board-head span",
  ".mk-board-foot",
  ".mk-chip-live",
  ".mk-chip-soon",
  ".mk-chip-next",
];

const overflowAt = (page: Page) =>
  page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));

(async () => {
  try {
    await fetch(URL_);
  } catch {
    console.log(`SKIP verify-marketing-page — no server at ${BASE}; start one with \`npm run dev\``);
    return;
  }

  const browser = await chromium.launch();

  try {
    // ── The page renders at all, and quietly ────────────────────────────────
    console.log("\nIT LOADS WITHOUT COMPLAINING");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("requestfailed", (r) => {
      // Next prefetches every <Link> in view and cancels them on navigation.
      // An aborted RSC prefetch is the router working, not a broken request.
      if (r.url().includes("_rsc=") || r.failure()?.errorText === "net::ERR_ABORTED") return;
      errors.push(`${r.url()} — ${r.failure()?.errorText}`);
    });
    await page.goto(URL_, { waitUntil: "networkidle" });

    (await page.title()).startsWith("Awer")
      ? ok("the page is titled for Awer, not for the tenant app")
      : bad("wrong title", await page.title());
    errors.length === 0
      ? ok("no console errors, no failed requests")
      : bad(`${errors.length} console/network error(s)`, errors.slice(0, 3).join(" | "));

    // ── Prices cannot drift from what we enforce ────────────────────────────
    console.log("\nTHE PRICES ARE THE ONES WE CHARGE");
    const body = await page.evaluate(() => document.querySelector(".mk")?.textContent ?? "");
    for (const [key, plan] of Object.entries(PLANS)) {
      if (plan.monthlyUsd == null) continue;
      body.includes(`$${plan.monthlyUsd}`)
        ? ok(`${plan.label} shows $${plan.monthlyUsd}, from PLANS`)
        : bad(`${key} price missing from the page`, `expected $${plan.monthlyUsd}`);
    }
    body.includes(`${TRIAL_DAYS} days`)
      ? ok(`the trial is quoted as ${TRIAL_DAYS} days, from PLANS`)
      : bad("trial length missing or hardcoded elsewhere");

    // The cleaner cap is both the line under the price AND the first highlight
    // PLANS ships, which put "Up to 5 cleaners" on the card twice.
    const dupes = await page.evaluate(() =>
      [...document.querySelectorAll(".mk-plan")]
        .map((card) => {
          const cap = card.querySelector(".mk-plan-cap")?.textContent?.trim() ?? "";
          const hits = [...card.querySelectorAll(".mk-checks li")].filter(
            (li) => li.textContent?.trim().toLowerCase() === cap.toLowerCase(),
          ).length;
          return { cap, hits };
        })
        .filter((r) => r.hits > 0),
    );
    dupes.length === 0
      ? ok("no plan states its cleaner cap twice")
      : bad(`${dupes.length} plan(s) repeat the cap`, dupes.map((d) => d.cap).join(", "));

    // ── Contrast, on both grounds ───────────────────────────────────────────
    console.log("\nEVERY PIECE OF TEXT CLEARS ITS CONTRAST FLOOR");
    const ratios = (await page.evaluate(contrastProbe(TEXT))) as Record<
      string,
      { ratio?: number; need?: number; size?: number; missing?: boolean }
    >;
    for (const sel of TEXT) {
      const r = ratios[sel];
      if (!r || r.missing) {
        bad(`${sel} is not on the page — the check is measuring nothing`);
        continue;
      }
      (r.ratio ?? 0) >= (r.need ?? 4.5)
        ? ok(`${sel} — ${r.ratio}:1 at ${r.size}px (needs ${r.need}:1)`)
        : bad(`${sel} — ${r.ratio}:1 at ${r.size}px, below ${r.need}:1`);
    }

    // ── Nothing scrolls sideways, at any width anyone owns ──────────────────
    console.log("\nNO WIDTH MAKES THE PAGE SCROLL SIDEWAYS");
    for (const width of [320, 375, 414, 560, 768, 900, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(60);
      const { scrollW, clientW } = await overflowAt(page);
      scrollW <= clientW + 1
        ? ok(`${width}px — content fits (${scrollW} ≤ ${clientW})`)
        : bad(`${width}px — ${scrollW - clientW}px of horizontal overflow`);
    }

    // ── Cards keep their shape between a phone and a laptop ────────────────
    console.log("\nCARDS DO NOT STRETCH ACROSS A TABLET");
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(80);
    const stretched = await page.evaluate(() =>
      [...document.querySelectorAll(".mk-plan, .mk-door")]
        .map((el) => ({
          cls: el.className.split(" ")[0],
          w: Math.round(el.getBoundingClientRect().width),
        }))
        .filter((c) => c.w > 560),
    );
    stretched.length === 0
      ? ok("at 768px no card is wider than 560px")
      : bad(
          `${stretched.length} card(s) stretch past 560px on a tablet`,
          stretched.map((c) => `${c.cls} ${c.w}px`).join(", "),
        );

    // ── Every target is big enough for a thumb ──────────────────────────────
    console.log("\nEVERY LINK AND BUTTON IS AT LEAST 44px TALL");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(80);
    const short = await page.evaluate(() =>
      [...document.querySelectorAll(".mk a, .mk button, .mk summary")]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { t: (el.textContent ?? "").trim().slice(0, 30), h: Math.round(r.height) };
        })
        // A zero-height box is one inside a closed <details>, not a small target.
        .filter((x) => x.h > 0 && x.h < 44),
    );
    short.length === 0
      ? ok("nothing on a phone is smaller than a 44px target")
      : bad(`${short.length} target(s) under 44px`, short.map((s) => `${s.t} (${s.h}px)`).join(", "));

    // ── The reveal is decoration, and decoration cannot hide the page ───────
    console.log("\nSCROLL REVEALS RESOLVE, AND FAIL OPEN WHEN THEY CANNOT");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL_, { waitUntil: "networkidle" });
    const revealed = await page.evaluate(async () => {
      const total = document.querySelectorAll("[data-reveal]").length;
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      await new Promise((r) => setTimeout(r, 800));
      const hidden = [...document.querySelectorAll("[data-reveal]")].filter(
        (el) => getComputedStyle(el).opacity !== "1",
      ).length;
      return { total, hidden };
    });
    revealed.total > 0
      ? ok(`${revealed.total} sections are set to reveal on scroll`)
      : bad("nothing carries data-reveal — the check is measuring nothing");
    revealed.hidden === 0
      ? ok("after scrolling the page, nothing is left invisible")
      : bad(`${revealed.hidden} section(s) never became visible`);

    await ctx.close();

    // Reduced motion must never receive the hidden start state at all — not
    // "receive it and have it removed", which is a page that flashes. That is
    // why the override is a media query rather than something Reveal does.
    const calm = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const calmPage = await calm.newPage();
    await calmPage.goto(URL_, { waitUntil: "domcontentloaded" });
    const calmHidden = await calmPage.evaluate(
      () =>
        [...document.querySelectorAll("[data-reveal]")].filter(
          (el) => getComputedStyle(el).opacity !== "1",
        ).length,
    );
    calmHidden === 0
      ? ok("reduced motion sees the whole page immediately, before any script runs")
      : bad(`${calmHidden} section(s) hidden under reduced motion`);
    await calm.close();

    // And with no JavaScript at all, which is what a crawler and a broken
    // hydration both look like.
    const noJs = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    });
    const noJsPage = await noJs.newPage();
    await noJsPage.goto(URL_, { waitUntil: "domcontentloaded" });
    const noJsText = (await noJsPage.textContent(".mk")) ?? "";
    noJsText.includes("Claim your address")
      ? ok("with JavaScript off the whole page is still served")
      : bad("the page depends on JavaScript to show its content");
    // Served is not the same as visible: the <noscript> override is what makes
    // the difference between a readable page and six invisible sections.
    const noJsHidden = await noJsPage.evaluate(
      () =>
        [...document.querySelectorAll("[data-reveal]")].filter(
          (el) => getComputedStyle(el).opacity !== "1",
        ).length,
    );
    noJsHidden === 0
      ? ok("with JavaScript off every section is visible, not just present")
      : bad(`${noJsHidden} section(s) invisible without JavaScript`);
    await noJs.close();

    // ── The accordion is a real disclosure, not a decorated div ─────────────
    console.log("\nTHE QUESTIONS OPEN");
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(URL_, { waitUntil: "networkidle" });
    await p2.locator(".mk-q summary").first().click();
    const opened = await p2.evaluate(() => {
      const q = document.querySelector(".mk-q") as HTMLDetailsElement | null;
      const p = q?.querySelector("p");
      return { open: !!q?.open, visible: !!p && p.getBoundingClientRect().height > 0 };
    });
    opened.open && opened.visible
      ? ok("clicking a question opens it and shows the answer")
      : bad("the accordion did not open", JSON.stringify(opened));

    // ── Keyboard users can see where they are ──────────────────────────────
    console.log("\nKEYBOARD FOCUS IS VISIBLE");
    await p2.keyboard.press("Tab");
    await p2.keyboard.press("Tab");
    const outline = await p2.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, width: cs.outlineWidth, style: cs.outlineStyle };
    });
    outline && outline.style !== "none" && parseFloat(outline.width) >= 2
      ? ok(`focus draws a ${outline.width} outline on <${outline.tag.toLowerCase()}>`)
      : bad("focused element has no visible outline", JSON.stringify(outline));

    await ctx2.close();
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
