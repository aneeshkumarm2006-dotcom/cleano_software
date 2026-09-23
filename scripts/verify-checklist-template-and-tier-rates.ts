/**
 * The two sub-bullets the Sept 17 list deliberately deferred, now built:
 * item 18's "save a one-off checklist as a reusable template", and item 22's
 * "default hourly rates by tier in Settings".
 *
 * Both are about REUSE, and both have the same way of going wrong: reaching
 * backwards into work that is already priced or already agreed. These tests
 * pin the direction as much as the arithmetic.
 */
import { readFileSync } from "node:fs";
import {
  checkTemplateName,
  parseCustomChecklist,
  templateItemsFrom,
  TEMPLATE_NAME_MAX,
} from "../src/lib/job-checklist";
import {
  NO_TIER_HOURLY_RATES,
  defaultHourlyRateFor,
  hourlyRateSource,
} from "../src/lib/pay-tiers";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

/* ------------------------- item 18: the template ------------------------- */

check("a name is trimmed", (checkTemplateName("  Deep clean  ") as { name: string }).name === "Deep clean");
check("inner whitespace collapses", (checkTemplateName("Move  out   kit") as { name: string }).name === "Move out kit");
check("an empty name is refused", !checkTemplateName("").ok);
check("a whitespace name is refused", !checkTemplateName("   ").ok);
check("a non-string is refused", !checkTemplateName(undefined).ok);
check(`over ${TEMPLATE_NAME_MAX} chars is refused`, !checkTemplateName("x".repeat(TEMPLATE_NAME_MAX + 1)).ok);
check(`exactly ${TEMPLATE_NAME_MAX} is allowed`, checkTemplateName("x".repeat(TEMPLATE_NAME_MAX)).ok);

// The one-off list has no sort column: its order IS its array order. A template
// that reordered the steps would not be the checklist the admin just approved.
{
  const items = parseCustomChecklist([
    { title: "Strip the beds", isRequired: true },
    { title: "Wipe the baseboards", description: "Including behind the door", isRequired: false },
    { title: "Final photo", isRequired: true },
  ]);
  const mapped = templateItemsFrom(items);
  check("every step survives", mapped.length === 3);
  check("order is preserved as sortOrder", mapped.map((m) => m.sortOrder).join() === "0,1,2");
  check("the first step is still first", mapped[0].title === "Strip the beds");
  check("descriptions survive", mapped[1].description === "Including behind the door");
  check("a missing description becomes null", mapped[0].description === null);
  check("required survives", mapped[0].isRequired === true);
  check("not-required survives", mapped[1].isRequired === false);
}
check("an empty list maps to nothing", templateItemsFrom([]).length === 0);

// The action must take a COPY, never point the template at the job, or editing
// the job would rewrite a template other jobs depend on.
{
  const src = read("src/app/admin/actions/saveChecklistAsTemplate.ts");
  check("the action refuses a job with no one-off list", src.includes("no one-off checklist to save"));
  check("it refuses client scope without a client", src.includes("isn't linked to a client"));
  check("it refuses a duplicate name", src.includes("There's already a template called"));
  check("template + items are one transaction", src.includes("db.$transaction(async (tx)"));
  // A copy, not a link. The check is that the action never UPDATES the job:
  // `customChecklist` appears once, in the select that reads it.
  check("it never updates the job", !/\.job\.update|\.job\.updateMany/.test(src));
  check(
    "customChecklist is only read, never written",
    (src.match(/customChecklist/g) ?? []).length === 2 && src.includes("customChecklist: true,"),
  );
  check("the save is audit-logged", src.includes("checklist.template.saved_from_job"));
}
{
  const ui = read("src/app/admin/jobs/[id]/JobDetailView.tsx");
  check("the control shows only on a CUSTOM checklist", ui.includes("summary.tier === 'CUSTOM'"));
}

/* -------------------- item 22: hourly rates by tier --------------------- */

const RATES = { TRAINEE: 18, STANDARD: 25, FIELD_LEAD: 32 };

check("a cleaner's own rate wins", defaultHourlyRateFor({ defaultHourlyRate: 40, cleanerTier: "TRAINEE" }, RATES) === 40);
check("a blank rate falls to the tier", defaultHourlyRateFor({ defaultHourlyRate: null, cleanerTier: "TRAINEE" }, RATES) === 18);
check("field lead gets the field lead rate", defaultHourlyRateFor({ defaultHourlyRate: null, cleanerTier: "FIELD_LEAD" }, RATES) === 32);
check("a missing tier is treated as Standard", defaultHourlyRateFor({ defaultHourlyRate: null }, RATES) === 25);
check("no tier defaults means no answer", defaultHourlyRateFor({ defaultHourlyRate: null, cleanerTier: "STANDARD" }, NO_TIER_HOURLY_RATES) === null);
check("no rates argument at all means no answer", defaultHourlyRateFor({ defaultHourlyRate: null }) === null);

// Null, not 0, for "we don't know". Zero is a rate an admin can legitimately
// type (an unpaid shadow shift), so the two must not be the same value.
check("an unknown rate is null, not zero", defaultHourlyRateFor({ defaultHourlyRate: null }, NO_TIER_HOURLY_RATES) !== 0);
check("a zero tier rate is not an answer", defaultHourlyRateFor({ defaultHourlyRate: null, cleanerTier: "STANDARD" }, { ...RATES, STANDARD: 0 }) === null);
check("a zero profile rate falls through to the tier", defaultHourlyRateFor({ defaultHourlyRate: 0, cleanerTier: "STANDARD" }, RATES) === 25);

check("the source reads as profile", hourlyRateSource({ defaultHourlyRate: 40, cleanerTier: "TRAINEE" }, RATES) === "profile");
check("the source reads as tier", hourlyRateSource({ defaultHourlyRate: null, cleanerTier: "TRAINEE" }, RATES) === "tier");
check("the source reads as none", hourlyRateSource({ defaultHourlyRate: null }, NO_TIER_HOURLY_RATES) === "none");

// The settings must be registered, audited and flagged as money.
{
  const reg = read("src/lib/settings/registry.ts");
  for (const key of ["provider.hourlyRateTrainee", "provider.hourlyRateStandard", "provider.hourlyRateFieldLead"]) {
    check(`${key} is registered`, reg.includes(`"${key}": def({`));
  }
  const block = reg.slice(reg.indexOf("provider.hourlyRateTrainee"), reg.indexOf("provider.showCustomerPhone"));
  check("the tier rates are audited", (block.match(/audit: true/g) ?? []).length === 3);
  check("the tier rates are flagged sensitive", (block.match(/sensitive: true/g) ?? []).length === 3);
  check("they default to 0, so nothing changes until set", (block.match(/default: 0,/g) ?? []).length === 3);
}

// They must not reach back into priced work. `JobAssignment.hourlyRate` is the
// snapshot that prevents it, so nothing here may read these settings in a pay
// calculation.
{
  const earnings = read("src/lib/cleaner-earnings.ts");
  check(
    "pay maths does not read the tier settings",
    !earnings.includes("hourlyRateTrainee") &&
      !earnings.includes("getTierHourlyRates") &&
      !earnings.includes("defaultHourlyRateFor"),
  );
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
