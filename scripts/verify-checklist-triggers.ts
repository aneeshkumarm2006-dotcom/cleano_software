// Verification for fix list item 27 — separate checklist triggers for add-ons —
// and, from "§ Stage 10" below, for the customer / contract scoping and the
// resolution precedence added by _ai_context/TODO.md Stage 10 (PDF #10).
import fs from "node:fs";
import {
  addOnKey,
  describeScope,
  describeTrigger,
  resolveChecklistTemplates,
  templateMatchesJob,
  templateScopeMatchesJob,
  wantedCategoriesFor,
  type ChecklistScopedTemplate,
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

// ═══════════════════════════════════════════════════════════════════════════
// § Stage 10 — customer / contract-specific checklists (PDF #10)
// ═══════════════════════════════════════════════════════════════════════════
//
// The PDF's worked example, spelled out as data. MCK is the strict customer
// list; COMMERCIAL_DEFAULT is the service-type list it has to BEAT.

const MCK_CLIENT = "client_mckiernan";
const MCK_ADDRESS = "addr_mck_main_st";
const OTHER_CLIENT = "client_someone_else";

const tpl = (
  id: string,
  over: Partial<ChecklistScopedTemplate> = {}
): ChecklistScopedTemplate => ({
  id,
  jobType: null,
  addOnName: null,
  clientId: null,
  clientAddressId: null,
  ...over,
});

const COMMERCIAL_DEFAULT = tpl("t_commercial", { jobType: "C - Commercial" });
const GLOBAL = tpl("t_global");
const MCK_ALL = tpl("t_mck", { clientId: MCK_CLIENT });
const MCK_MAIN_ST = tpl("t_mck_main", {
  clientId: MCK_CLIENT,
  clientAddressId: MCK_ADDRESS,
});
const MCK_DEEP_ONLY = tpl("t_mck_deep", {
  clientId: MCK_CLIENT,
  jobType: "DEEP - Deep Cleaning",
});
const ONE_OFF = tpl("t_one_off", { jobType: "R - Residential" });

const ALL = [COMMERCIAL_DEFAULT, GLOBAL, MCK_ALL, MCK_MAIN_ST, MCK_DEEP_ONLY, ONE_OFF];

const job = (over: Partial<Parameters<typeof resolveChecklistTemplates>[1]> = {}) => ({
  jobType: "C - Commercial",
  addOnNames: [] as string[],
  clientId: null as string | null,
  clientAddressId: null as string | null,
  checklistTemplateId: null as string | null,
  ...over,
});

const idsOf = (r: { templates: ChecklistScopedTemplate[] }) =>
  r.templates.map((t) => t.id);

// ── Scope matching in isolation ─────────────────────────────────────────────
ok("an unscoped template matches any job",
  templateScopeMatchesJob(GLOBAL, job()));
ok("a client-scoped template matches that client's job",
  templateScopeMatchesJob(MCK_ALL, job({ clientId: MCK_CLIENT })));
ok("...and NOT another client's job",
  !templateScopeMatchesJob(MCK_ALL, job({ clientId: OTHER_CLIENT })));
ok("...and not a job with no client at all",
  !templateScopeMatchesJob(MCK_ALL, job({ clientId: null })));
ok("an address-scoped template matches only that address",
  templateScopeMatchesJob(MCK_MAIN_ST,
    job({ clientId: MCK_CLIENT, clientAddressId: MCK_ADDRESS })));
ok("...and not the same customer's OTHER location",
  !templateScopeMatchesJob(MCK_MAIN_ST,
    job({ clientId: MCK_CLIENT, clientAddressId: "addr_other" })));

// ── THE PDF's example: the customer list overrides the service default ──────
check("an unlinked commercial job still gets the service default",
  idsOf(resolveChecklistTemplates(ALL, job())),
  ["t_commercial", "t_global"]);
check("every Mckiernan job gets the Mckiernan list INSTEAD of the default",
  idsOf(resolveChecklistTemplates(ALL, job({ clientId: MCK_CLIENT }))),
  ["t_mck"]);
check("...and other clients are unaffected",
  idsOf(resolveChecklistTemplates(ALL, job({ clientId: OTHER_CLIENT }))),
  ["t_commercial", "t_global"]);
check("the tier says WHY",
  resolveChecklistTemplates(ALL, job({ clientId: MCK_CLIENT })).tier, "CLIENT");
check("...and for an unlinked job",
  resolveChecklistTemplates(ALL, job()).tier, "DEFAULT");

// The global template is REPLACED, not appended. The whole point of a strict
// list is that the generic items don't come along.
ok("the global template does not tag along behind a customer list",
  !idsOf(resolveChecklistTemplates(ALL, job({ clientId: MCK_CLIENT }))).includes("t_global"));

// ── Address beats client ────────────────────────────────────────────────────
check("one location's list beats the customer-wide list",
  idsOf(resolveChecklistTemplates(ALL,
    job({ clientId: MCK_CLIENT, clientAddressId: MCK_ADDRESS }))),
  ["t_mck_main"]);
check("...reported as the ADDRESS tier",
  resolveChecklistTemplates(ALL,
    job({ clientId: MCK_CLIENT, clientAddressId: MCK_ADDRESS })).tier, "ADDRESS");
check("their other locations fall back to the customer-wide list",
  idsOf(resolveChecklistTemplates(ALL,
    job({ clientId: MCK_CLIENT, clientAddressId: "addr_other" }))),
  ["t_mck"]);

// ── Service triggers still apply INSIDE a customer tier ─────────────────────
check("a customer template scoped to one service fires on that service",
  idsOf(resolveChecklistTemplates([MCK_DEEP_ONLY, COMMERCIAL_DEFAULT],
    job({ jobType: "DEEP - Deep Cleaning", clientId: MCK_CLIENT }))),
  ["t_mck_deep"]);
check("...and does NOT fire on that customer's other services",
  idsOf(resolveChecklistTemplates([MCK_DEEP_ONLY, COMMERCIAL_DEFAULT],
    job({ jobType: "C - Commercial", clientId: MCK_CLIENT }))),
  ["t_commercial"]);

// ── The per-job pin beats everything ────────────────────────────────────────
check("a pinned template wins over the customer list",
  idsOf(resolveChecklistTemplates(ALL,
    job({ clientId: MCK_CLIENT, checklistTemplateId: "t_one_off" }))),
  ["t_one_off"]);
check("...reported as the JOB tier",
  resolveChecklistTemplates(ALL,
    job({ clientId: MCK_CLIENT, checklistTemplateId: "t_one_off" })).tier, "JOB");
// A pin is an explicit instruction, so it is not re-tested against the
// template's own service trigger — ONE_OFF is Residential-scoped and this job
// is Commercial.
ok("a pin ignores the pinned template's own service trigger",
  idsOf(resolveChecklistTemplates(ALL,
    job({ jobType: "C - Commercial", checklistTemplateId: "t_one_off" }))).length === 1);

// Deactivated/deleted pin → fall back, and SAY SO. A silent swap is the one
// outcome that must not happen: the cleaner's list would change with nobody
// having touched the job.
const stalePin = resolveChecklistTemplates(ALL,
  job({ clientId: MCK_CLIENT, checklistTemplateId: "t_deleted" }));
check("an unavailable pin falls back to automatic resolution",
  idsOf(stalePin), ["t_mck"]);
ok("...and is reported, not swallowed", stalePin.pinnedUnavailable === true);
ok("a healthy resolution does not raise the flag",
  resolveChecklistTemplates(ALL, job()).pinnedUnavailable === false);

// ── Nothing matches ─────────────────────────────────────────────────────────
const nothing = resolveChecklistTemplates([COMMERCIAL_DEFAULT],
  job({ jobType: "R - Residential" }));
check("no match reports the NONE tier", nothing.tier, "NONE");
check("...with no templates", idsOf(nothing), []);

// ── Scope descriptions (the Settings chip and the job picker) ───────────────
check("describes a customer-wide scope",
  describeScope({ clientId: MCK_CLIENT, clientAddressId: null, clientName: "Mckiernan" }),
  "Mckiernan — all locations");
check("describes a location scope",
  describeScope({
    clientId: MCK_CLIENT, clientAddressId: MCK_ADDRESS,
    clientName: "Mckiernan", addressLabel: "12 Main St",
  }),
  "Mckiernan — 12 Main St");
check("an unscoped template has no scope chip",
  describeScope({ clientId: null, clientAddressId: null }), null);

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

// The generator delegates to `ensureJobChecklist`, which is where the shared
// rule is applied — one generation path for the action, the job page and the
// clock screen. Follow the delegation rather than asserting the rule lives in
// a file it deliberately no longer lives in.
const gen = read("src/app/admin/actions/generateJobChecklist.ts");
ok("generator delegates to the one shared generation path",
  gen.includes("ensureJobChecklist"));
// Stage 10 replaced the bare `templateMatchesJob` filter with the precedence
// resolver, which calls it internally. Assert the resolver, not the rule it
// wraps — asserting the old symbol would pass again the day somebody
// reintroduced the flat filter alongside it.
const store = read("src/lib/job-checklist.server.ts");
ok("generator uses the shared precedence resolver",
  store.includes("resolveChecklistTemplates("));
ok("...and feeds it the customer link and the per-job pin",
  store.includes("clientId: job.clientId") &&
  store.includes("checklistTemplateId: job.checklistTemplateId"));
ok("generated checklists record which template produced them (step 10.3)",
  store.includes("primaryTemplateId(resolved)") &&
  !store.includes("templateId: null"));

// The pre-claim preview must answer with the SAME list the cleaner gets after
// claiming — and must still write nothing (verify-awer-fixes-3 owns that half).
const preview = read("src/app/cleaners/available-jobs/getAvailableJobPreview.ts");
ok("the pre-claim preview runs the same resolver",
  preview.includes("resolveChecklistTemplates("));
ok("...with the job's customer link", preview.includes("clientId: job.clientId"));

// Both job-save paths (TODO §4's two-save-paths ⚠️).
for (const [label, path] of [
  ["job modal action", "src/app/admin/actions/saveJob.ts"],
  ["full-page job form", "src/app/admin/jobs/new/page.tsx"],
] as const) {
  const src = read(path);
  ok(`${label} reads the checklist pin as a tri-state`,
    src.includes('formData.has("checklistTemplateId")'));
  ok(`${label} preserves the pin when the form omits it`,
    src.includes("preservedFields?.checklistTemplateId"));
  ok(`${label} writes the pin`, src.includes("checklistTemplateId,"));
}
ok("the job modal posts the pin on every save, blank included",
  read("src/app/admin/jobs/JobModal.tsx")
    .includes('formData.append("checklistTemplateId", checklistTemplateId)'));

// Recurring consistency (step 10.6) — the PDF asks for it by name.
ok("the pin propagates across a recurring series",
  read("src/lib/job-series.ts").includes('"checklistTemplateId"'));

// Both write actions validate the scope through the one shared helper, which
// is what guarantees an address-scoped template always carries its client id —
// the assumption the ON DELETE SET NULL degradation rests on.
for (const path of [
  "src/app/admin/actions/createChecklistTemplate.ts",
  "src/app/admin/actions/updateChecklistTemplate.ts",
]) {
  ok(`${path.split("/").pop()} validates the customer scope`,
    read(path).includes("resolveTemplateScope(input)"));
}
const scopeGuard = read("src/lib/checklist-scope.server.ts");
ok("an address with no customer is rejected outright",
  scopeGuard.includes("Pick the customer before picking one of their locations."));
ok("an address belonging to another customer is rejected",
  scopeGuard.includes("clientId: client.id"));

// The Settings editor.
const tab2 = read("src/app/admin/settings/tabs/ChecklistTemplatesTab.tsx");
ok("the editor offers a customer picker", tab2.includes("— Not customer-specific —"));
ok("...and a location picker scoped to that customer",
  tab2.includes("addressChoices"));
ok("...clears the location when the customer changes",
  tab2.includes('clientAddressId: "",'));
ok("the list shows a scope chip", tab2.includes("describeScope({"));
ok("...and says the customer list overrides the service default",
  tab2.includes("Overrides the service default"));

// The admin's per-job view — the gap step 10.5 exists to close.
const detail = read("src/app/admin/jobs/[id]/JobDetailView.tsx");
ok("the job detail page shows the resolved checklist",
  detail.includes("<ChecklistCard summary={checklistSummary} />"));
ok("...and it is read-only (no generate button)",
  !detail.includes("generateJobChecklist"));

// The migration is written but NOT applied — the whole batch lands at once.
ok("the Stage 10 migration exists",
  fs.existsSync("prisma/migrations/20260817050000_add_checklist_links/migration.sql"));
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
