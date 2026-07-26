// Verification for fix list item 27 — separate checklist triggers for add-ons.
import fs from "node:fs";
import {
  addOnKey,
  describeTrigger,
  templateMatchesJob,
  wantedCategoriesFor,
} from "../src/lib/checklist-triggers";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const residentialJob = { jobType: "R - Residential", addOnNames: ["Inside Fridge"] };
const plainResidential = { jobType: "R - Residential", addOnNames: [] };
const deepWithFridge = { jobType: "DEEP - Deep Cleaning", addOnNames: ["Inside Fridge"] };

// ── Job type only ──────────────────────────────────────────────────────────
ok("job-type template matches that service",
  templateMatchesJob({ jobType: "R - Residential", addOnName: null }, plainResidential));
ok("job-type template ignores other services",
  !templateMatchesJob({ jobType: "R - Residential", addOnName: null }, deepWithFridge));
// Web bookings store a different vocabulary than the admin form.
ok("matches across vocabularies (web booking 'STANDARD')",
  templateMatchesJob({ jobType: "R - Residential", addOnName: null },
    { jobType: "STANDARD", addOnNames: [] }));

// ── Add-on only ────────────────────────────────────────────────────────────
ok("add-on template matches any job carrying it",
  templateMatchesJob({ jobType: null, addOnName: "Inside Fridge" }, deepWithFridge));
ok("add-on template does not fire without the add-on",
  !templateMatchesJob({ jobType: null, addOnName: "Inside Fridge" }, plainResidential));

// ── Case-insensitivity (defect 1) ──────────────────────────────────────────
// The old matcher was case-sensitive — the Settings hint even said so — so a
// trigger silently never fired if the spelling differed.
ok("add-on match ignores case",
  templateMatchesJob({ jobType: null, addOnName: "inside fridge" }, deepWithFridge));
ok("add-on match ignores surrounding whitespace",
  templateMatchesJob({ jobType: null, addOnName: "  Inside Fridge  " }, deepWithFridge));
ok("add-on match collapses inner whitespace",
  templateMatchesJob({ jobType: null, addOnName: "Inside  Fridge" }, deepWithFridge));
ok("a genuinely different add-on still does not match",
  !templateMatchesJob({ jobType: null, addOnName: "Inside Oven" }, deepWithFridge));
check("addOnKey normalizes", addOnKey("  Inside   FRIDGE "), "inside fridge");

// ── BOTH (defect 2 — this was the broken one) ──────────────────────────────
const both = { jobType: "R - Residential", addOnName: "Inside Fridge" };
ok("BOTH fires when service AND add-on match", templateMatchesJob(both, residentialJob));
ok("BOTH does NOT fire on the right service without the add-on",
  !templateMatchesJob(both, plainResidential));
ok("BOTH does NOT fire on the wrong service with the add-on",
  !templateMatchesJob(both, deepWithFridge));

// ── Global ─────────────────────────────────────────────────────────────────
ok("global template applies to everything",
  templateMatchesJob({ jobType: null, addOnName: null }, plainResidential) &&
  templateMatchesJob({ jobType: null, addOnName: null }, deepWithFridge));

// ── Combined move jobs pull in both halves ─────────────────────────────────
check("MOVE_IN_OUT wants all three move categories",
  [...wantedCategoriesFor("MOVE_IN_OUT")].sort(),
  ["MOVE_IN", "MOVE_IN_OUT", "MOVE_OUT"]);
ok("a Move-in template attaches to a combined move job",
  templateMatchesJob({ jobType: "MOVE_IN - Move-in Cleaning", addOnName: null },
    { jobType: "MOVE_IN_OUT", addOnNames: [] }));

// ── Trigger description ────────────────────────────────────────────────────
check("describes a both-scoped trigger",
  describeTrigger(both), 'R - Residential + add-on "Inside Fridge"');
check("describes a global trigger",
  describeTrigger({ jobType: null, addOnName: null }), "All jobs");

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const gen = read("src/app/admin/actions/generateJobChecklist.ts");
ok("generator uses the shared trigger rule", gen.includes("templateMatchesJob"));
ok("generator no longer does case-sensitive add-on matching in SQL",
  !gen.includes("addOnName: { in: addOnNames }"));
ok("generator no longer short-circuits on jobType alone",
  !gen.includes("if (t.jobType) return wantedCategories.has"));

const tab = read("src/app/admin/settings/tabs/ChecklistTemplatesTab.tsx");
ok("add-on trigger is a picker, not free text",
  !tab.includes('placeholder="e.g. Inside Fridge"'));
ok("picker is sourced from Settings add-ons", tab.includes('"pricing.addOns"'));
ok("the misleading 'case-sensitive match' hint is gone",
  !tab.includes("case-sensitive match"));
ok("an add-on saved but no longer configured stays visible",
  tab.includes("is not in Settings → Pricing Rules"));
ok("the AND behaviour is stated in the editor",
  tab.includes("this service type AND has this add-on"));
ok("the list flags both-scoped templates", tab.includes("Both must match"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
