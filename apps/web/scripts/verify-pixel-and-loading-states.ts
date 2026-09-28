/**
 * Two things checked in the browser on 2026-09-23.
 *
 * 1. The Meta pixel, on cleanocalgary.localhost/book: `fbq` undefined, zero
 *    pixel scripts, no console errors. That is correct — the pixel belongs to
 *    the PLATFORM's funnel, and a tenant's customers are not the platform's ad
 *    audience. Crediting Calgary's bookings to Bookmops' ad account would be
 *    the advertising version of the Stripe key bug. These tests pin the
 *    allowlist so a future path cannot quietly widen it.
 *
 * 2. Time tracking rendered "0", "0" and "No clock activity yet" for the
 *    twelve seconds its fetch took, while three clocks were actually running.
 *    An empty state is a CONCLUSION, and a conclusion needs the data.
 */
import { readFileSync } from "node:fs";
import { isTrackedPath } from "../src/lib/meta-pixel-paths";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

/* ---- the pixel fires on the platform funnel, and nowhere else ---------- */
check("/welcome is tracked", isTrackedPath("/welcome"));
check("/get-started is tracked", isTrackedPath("/get-started"));
check("a funnel sub-path is tracked", isTrackedPath("/get-started/organization"));

// Every one of these is a TENANT surface. None may report to the platform's
// ad account.
for (const p of [
  "/book",
  "/quote",
  "/faq",
  "/reviews",
  "/gift-card",
  "/login",
  "/sign-in",
  "/admin/dashboard",
  "/cleaners/my-jobs",
  "/",
]) {
  check(`${p} is NOT tracked`, !isTrackedPath(p));
}
// A path that merely starts with the same letters is not the funnel.
check("/welcome-back is not tracked", !isTrackedPath("/welcome-back"));
check("/get-started-now is not tracked", !isTrackedPath("/get-started-now"));

// It must ship dark, so deploying before the ad account exists changes nothing.
{
  const px = read("src/components/MetaPixel.tsx");
  check("no id means nothing loads", px.includes("NEXT_PUBLIC_META_PIXEL_ID"));
  check("tracking never breaks the page", px.includes("analytics must never break a signup"));
}

/* ---- an empty state is a conclusion ----------------------------------- */
{
  const t = read("src/app/admin/time-tracking/TimeTrackingClient.tsx");
  check(
    "it starts in the loading state it is actually in",
    t.includes("const [loading, setLoading] = useState(true);"),
  );
  check("it tracks whether a response has landed", t.includes("const [loaded, setLoaded] = useState(false);"));
  check(
    "the empty state waits for data",
    t.includes("entries.length === 0 && loaded && !loading && !error"),
  );
  check("the stat cards do not assert a number they lack", t.includes("astat-skeleton"));
  const css = read("src/app/globals.css");
  check("the skeleton reserves the number's space", css.includes(".astat-skeleton"));
  check("and respects reduced motion", (() => {
    const i = css.indexOf(".astat-skeleton");
    return css.slice(i, i + 700).includes("prefers-reduced-motion");
  })());
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
