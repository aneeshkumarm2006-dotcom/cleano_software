// Verification for fix list item 20 — sync job types between Settings and forms.
import fs from "node:fs";
import {
  DEFAULT_SERVICE_CATALOG,
  activeServices,
  inferCategoryFromName,
  normalizeServiceCatalog,
  resolveServiceLabel,
  resolveServiceValue,
  serviceLabelMap,
  serviceOptions,
} from "../src/lib/service-catalog";
import { jobTypeLabel } from "../src/lib/calendar-labels";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

// ── Defaults offer the COMBINED move service (the spec's worked example) ────
const defaultCats = DEFAULT_SERVICE_CATALOG.map((s) => s.category);
ok("defaults offer Move-in / Move-out as ONE service",
  defaultCats.includes("MOVE_IN_OUT"));
ok("defaults do NOT offer Move-in separately", !defaultCats.includes("MOVE_IN"));
ok("defaults do NOT offer Move-out separately", !defaultCats.includes("MOVE_OUT"));

// ── Legacy Settings rows (name-only, no category) still resolve ─────────────
const legacyStored = [
  { id: "a", name: "Standard Cleaning", isActive: true },
  { id: "b", name: "Deep Cleaning", isActive: true },
  { id: "c", name: "Move-In/Out", isActive: true },
  { id: "d", name: "Post-Construction", isActive: true },
];
const migrated = normalizeServiceCatalog(legacyStored);
check("legacy 'Standard Cleaning' maps to RESIDENTIAL", migrated[0].category, "RESIDENTIAL");
check("legacy 'Deep Cleaning' maps to DEEP", migrated[1].category, "DEEP");
check("legacy 'Move-In/Out' maps to the COMBINED category", migrated[2].category, "MOVE_IN_OUT");
check("legacy 'Post-Construction' maps correctly", migrated[3].category, "POST_CONSTRUCTION");
check("the admin's own names are preserved", migrated[0].name, "Standard Cleaning");

check("name inference: 'Move In / Move Out'", inferCategoryFromName("Move In / Move Out"), "MOVE_IN_OUT");
check("name inference: 'Airbnb Turnover'", inferCategoryFromName("Airbnb Turnover"), "AIRBNB");
check("name inference: 'Office Cleaning'", inferCategoryFromName("Office Cleaning"), "COMMERCIAL");
check("unknown names are not force-fitted", inferCategoryFromName("Zzz Nonsense"), null);

// ── Bad config must not break pickers ──────────────────────────────────────
check("absent config falls back to defaults", normalizeServiceCatalog(null), DEFAULT_SERVICE_CATALOG);
check("empty array falls back to defaults", normalizeServiceCatalog([]), DEFAULT_SERVICE_CATALOG);
check("all-unresolvable rows fall back to defaults",
  normalizeServiceCatalog([{ id: "x", name: "???", isActive: true }]), DEFAULT_SERVICE_CATALOG);
// Duplicate categories would put duplicate options in every picker.
check("duplicate categories are collapsed",
  normalizeServiceCatalog([
    { id: "1", name: "Deep Clean", category: "DEEP", isActive: true },
    { id: "2", name: "Deep Cleaning Plus", category: "DEEP", isActive: true },
  ]).length, 1);

// ── Renaming in Settings renames everywhere ────────────────────────────────
const renamed = normalizeServiceCatalog([
  { id: "1", name: "Sparkle Clean", category: "RESIDENTIAL", isActive: true },
  { id: "2", name: "Move Day Service", category: "MOVE_IN_OUT", isActive: true },
]);
const labels = serviceLabelMap(renamed);
check("a renamed service renames a stored canonical job",
  jobTypeLabel("RESIDENTIAL", labels), "Sparkle Clean");
check("a renamed service renames a LEGACY stored job",
  jobTypeLabel("R - Residential", labels), "Sparkle Clean");
check("booking-flow value maps to the admin name too",
  jobTypeLabel("STANDARD", labels), "Sparkle Clean");
// A legacy split-move job must not display a service no longer offered.
check("legacy MOVE_IN folds onto the combined service name",
  jobTypeLabel("MOVE_IN - Move-in Cleaning", labels), "Move Day Service");
check("no admin label falls back to the built-in label",
  jobTypeLabel("DEEP", labels), "Deep Cleaning");
check("omitting labels entirely is backward compatible",
  jobTypeLabel("R - Residential"), "Residential");

// ── Picker values are canonical keys, so renames never orphan jobs ─────────
const opts = serviceOptions(renamed);
ok("picker values are canonical category keys",
  opts.every((o) => o.value === o.value.toUpperCase()));
check("picker shows the admin's names", opts.map((o) => o.label), ["Sparkle Clean", "Move Day Service"]);
check("blank option is prependable", serviceOptions(renamed, { includeBlank: "Select type" })[0],
  { value: "", label: "Select type" });
check("filter option is prependable", serviceOptions(renamed, { includeAll: "All types" })[0],
  { value: "all", label: "All types" });

// Inactive services disappear from pickers but keep resolving for old jobs.
const withInactive = normalizeServiceCatalog([
  { id: "1", name: "Residential", category: "RESIDENTIAL", isActive: true },
  { id: "2", name: "Airbnb", category: "AIRBNB", isActive: false },
]);
check("inactive services are not offered", activeServices(withInactive).length, 1);
check("an inactive service still resolves its label for history",
  jobTypeLabel("AIRBNB", serviceLabelMap(withInactive)), "Airbnb");

// ── Editing an old job preselects the right service ────────────────────────
check("legacy value preselects the offered category",
  resolveServiceValue("R - Residential", renamed), "RESIDENTIAL");
check("legacy MOVE_OUT preselects the combined service",
  resolveServiceValue("MOVE_OUT - Move-out Cleaning", renamed), "MOVE_IN_OUT");
check("a no-longer-offered service preselects blank rather than a wrong one",
  resolveServiceValue("AIRBNB", renamed), "");
check("empty stays empty", resolveServiceValue(null, renamed), "");

check("resolveServiceLabel uses the fallback for unknown values",
  resolveServiceLabel("WEIRD_VALUE", labels, () => "Fallback"), "Fallback");

// ── No hardcoded lists left in the pickers ─────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");
// Matches a real option-list ENTRY, not prose — an earlier version of this
// check produced false failures on explanatory comments that merely quoted the
// old values.
const HARDCODED_ENTRY =
  /\{\s*value:\s*"(?:MOVE_IN|MOVE_OUT|MOVE_IN - [^"]*|MOVE_OUT - [^"]*|R|R - [^"]*|DEEP - [^"]*|PC|PC - [^"]*)"\s*,\s*label:/;

const noList = (file: string, label: string) => {
  const src = read(file);
  ok(`${label} has no hardcoded job-type list`, !HARDCODED_ENTRY.test(src));
};
noList("src/app/admin/jobs/JobModal.tsx", "job edit modal");
noList("src/app/admin/jobs/new/JobTypeSelector.tsx", "job creation form");
noList("src/app/admin/jobs/JobsView.tsx", "admin jobs filter");
noList("src/app/cleaners/my-jobs/JobsFilters.tsx", "cleaner jobs filter");
noList("src/app/admin/settings/tabs/ChecklistTemplatesTab.tsx", "checklist editor");

ok("cleaner job detail no longer has its own label switch",
  !read("src/app/cleaners/my-jobs/[jobId]/page.tsx").includes('case "R": return "Residential cleaning"'));

// Settings is now actually read.
const tab = read("src/app/admin/settings/tabs/JobTypesTab.tsx");
ok("Settings tab stores a category per service", tab.includes("category"));
ok("Settings tab rejects duplicate categories", tab.includes("same service category"));
ok("Settings tab uses the shared catalog key", tab.includes("SERVICE_CATALOG_KEY"));
const server = read("src/lib/service-catalog.server.ts");
ok("a server reader for the setting exists", server.includes("SERVICE_CATALOG_KEY"));
ok("jobs page reads the catalog",
  read("src/app/admin/jobs/page.tsx").includes("getServiceCatalog"));
ok("cleaner jobs page reads the catalog",
  read("src/app/cleaners/my-jobs/page.tsx").includes("getServiceCatalog"));
ok("invoices use admin service names",
  read("src/app/admin/actions/generateInvoiceFromJob.ts").includes("serviceLabels") &&
  read("src/app/admin/actions/createInvoice.ts").includes("serviceLabels"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
