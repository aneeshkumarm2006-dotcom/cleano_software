/* Billing arithmetic and pixel gating: the two places a quiet mistake costs
 * real money — an annual price that undercharges, or a pixel that follows
 * tenants into the product. */
import {
  ANNUAL_MONTHS_CHARGED,
  ANNUAL_MONTHS_SAVED,
  PLANS,
  effectiveMonthlyFor,
  priceFor,
  trialEndFrom,
  TRIAL_DAYS,
} from "../src/lib/plans";
import { isTrackedPath } from "../src/components/MetaPixel";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, got?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${got === undefined ? "" : `  → ${JSON.stringify(got)}`}`); }
};

async function main() {
  console.log("Prices");
  check("Starter monthly is the listed price", priceFor("STARTER", "MONTHLY") === PLANS.STARTER.monthlyUsd);
  check("Starter yearly charges 10 months", priceFor("STARTER", "ANNUAL") === 49 * ANNUAL_MONTHS_CHARGED, priceFor("STARTER", "ANNUAL"));
  check("Professional yearly charges 10 months", priceFor("PROFESSIONAL", "ANNUAL") === 149 * ANNUAL_MONTHS_CHARGED, priceFor("PROFESSIONAL", "ANNUAL"));
  check("a quoted tier has no price either way",
    priceFor("ORGANIZATION", "MONTHLY") === null && priceFor("ORGANIZATION", "ANNUAL") === null);
  check("yearly is never dearer than 12x monthly",
    (["STARTER", "PROFESSIONAL"] as const).every((p) => priceFor(p, "ANNUAL")! <= PLANS[p].monthlyUsd! * 12));
  check("two months are saved", ANNUAL_MONTHS_SAVED === 2, ANNUAL_MONTHS_SAVED);
  check("effective monthly on yearly is below the monthly price",
    effectiveMonthlyFor("STARTER", "ANNUAL")! < PLANS.STARTER.monthlyUsd!);
  check("effective monthly on monthly equals the monthly price",
    effectiveMonthlyFor("STARTER", "MONTHLY") === PLANS.STARTER.monthlyUsd);

  console.log("Trial");
  const start = new Date("2026-09-07T00:00:00Z");
  check(`trial runs ${TRIAL_DAYS} days`,
    Math.round((trialEndFrom(start).getTime() - start.getTime()) / 86400000) === TRIAL_DAYS);
  check("trial end is in the future", trialEndFrom(new Date()).getTime() > Date.now());

  console.log("Pixel is confined to the funnel");
  check("welcome is tracked", isTrackedPath("/welcome"));
  check("get-started is tracked", isTrackedPath("/get-started"));
  check("get-started subpages are tracked", isTrackedPath("/get-started/organization"));
  check("the admin app is NOT tracked", !isTrackedPath("/admin/settings"));
  check("the cleaner app is NOT tracked", !isTrackedPath("/cleaners/my-jobs"));
  check("a tenant booking page is NOT tracked", !isTrackedPath("/book"));
  check("the console is NOT tracked", !isTrackedPath("/console/billing"));
  check("a lookalike prefix is NOT tracked", !isTrackedPath("/welcome-back"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
