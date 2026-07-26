// Verification for fix list item 8 — square footage on the job modal.
import fs from "node:fs";
import {
  isSqftJobType,
  isSqftService,
  moveInOutBasePrice,
  SERVICE_PRICING_DEFAULTS,
} from "../src/lib/service-pricing";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

// ── Which job types are square-foot priced ─────────────────────────────────
// The admin form stores "MOVE_IN - Move-in Cleaning"; the booking flow stores
// "MOVE_IN_OUT". Both halves of a move are sqft-priced and must be recognised.
ok("booking vocabulary: MOVE_IN_OUT", isSqftJobType("MOVE_IN_OUT"));
ok("admin vocabulary: 'MOVE_IN - Move-in Cleaning'", isSqftJobType("MOVE_IN - Move-in Cleaning"));
ok("admin vocabulary: 'MOVE_OUT - Move-out Cleaning'", isSqftJobType("MOVE_OUT - Move-out Cleaning"));
ok("bare code: MOVE_IN", isSqftJobType("MOVE_IN"));
ok("residential is NOT sqft priced", !isSqftJobType("R - Residential"));
ok("deep clean is NOT sqft priced", !isSqftJobType("DEEP - Deep Cleaning"));
ok("post-construction is NOT sqft priced", !isSqftJobType("PC - Post Construction"));
ok("airbnb is NOT sqft priced", !isSqftJobType("AIRBNB - Airbnb Cleaning"));
ok("empty/null is safe", !isSqftJobType(null) && !isSqftJobType(""));

// The old helper only understood the booking vocabulary — this is exactly the
// gap that left admin move jobs unpriced by area.
ok("the pre-existing helper missed the admin vocabulary",
  !isSqftService("MOVE_IN - Move-in Cleaning"));

// ── Derived price ──────────────────────────────────────────────────────────
const cfg = SERVICE_PRICING_DEFAULTS;
const t = cfg.moveInOut.thresholdSqft;
ok("price scales with area",
  moveInOutBasePrice(t + 500, cfg) > moveInOutBasePrice(t - 500, cfg));
check("just below the threshold uses the small-home rate",
  moveInOutBasePrice(t - 1, cfg), +((t - 1) * cfg.moveInOut.rateBelow).toFixed(2));
// The comparison is `>=`, so the threshold value itself is the LARGE-home rate.
check("exactly at the threshold uses the large-home rate",
  moveInOutBasePrice(t, cfg), +(t * cfg.moveInOut.rateAtOrAbove).toFixed(2));
check("zero sq ft yields no price", moveInOutBasePrice(0, cfg), 0);

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const schema = read("prisma/schema.prisma");
ok("Job.squareFootage already exists (no migration needed)",
  /squareFootage\s+Int\?/.test(schema));

const saveJob = read("src/app/admin/actions/saveJob.ts");
ok("saveJob reads square footage", saveJob.includes('formData.get("squareFootage")'));
ok("saveJob persists it to the job record", /squareFootage,/.test(saveJob));
ok("saveJob derives the price for sqft services", saveJob.includes("isSqftJobType(jobTypeRaw)"));
ok("derivation only when the admin left price blank",
  saveJob.includes("price === null && squareFootage !== null"));

const form = read("src/app/admin/jobs/new/page.tsx");
ok("full-page form has the field", form.includes('name="squareFootage"'));
ok("full-page form persists it", /squareFootage,/.test(form));
ok("full-page form derives the price too", form.includes("isSqftJobType(jobTypeRaw)"));

const modal = read("src/app/admin/jobs/JobModal.tsx");
ok("modal has a Square Footage section", modal.includes("Square Footage"));
ok("modal registers the field", modal.includes('register("squareFootage")'));
ok("modal loads the saved value when editing", modal.includes('squareFootage: job.squareFootage ?? ""'));
ok("modal submits the value", modal.includes('formData.append("squareFootage"'));
ok("modal explains sqft-priced services", modal.includes("priced per square foot"));
ok("modal explains non-sqft services still store it",
  modal.includes("won't change the price"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
