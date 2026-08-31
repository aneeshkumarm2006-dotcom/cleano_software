// Verification for STAGE 3 of `_ai_context/TODO.md` —
// clock-out: closing inventory report, and the removal of estimated usage
// (cleano_inventory_operations_fixes.pdf #2 + the reporting bullets of #1).
//
// Run: npx tsx scripts/verify-stage3-closing-report.ts
//
// Two halves, same as the other verify-* scripts in this repo:
//   1. The PURE rules, exercised directly — `validateClosingReport()` decides
//      what a clock-out writes, so it is worth testing rather than grepping.
//   2. A SOURCE SWEEP proving the estimated-usage flow is GONE (not merely
//      unused), that one component serves both clock-out screens, and that the
//      admin can see what was reported.
//
// The DB is never touched: Stage 1's migration is still deferred, so every
// check here has to hold on code alone.

import fs from "node:fs";
import {
  MAX_KIT_QUANTITY,
  kindForItemType,
  validateClosingReport,
  describeReportForLog,
  type ClockOutKit,
  type ClosingReport,
  type ClosingReportValidation,
  type KitItem,
} from "../src/lib/clock-out";
import {
  COUNTABLE_STATUSES,
  EQUIPMENT_CONDITIONS,
  INVENTORY_FLAG_TYPES,
  LIQUID_LEVELS,
  conditionFlagType,
  countableStatusFlagType,
  levelFlagType,
  statusLabel,
} from "../src/lib/inventory-status";
import {
  INVENTORY_ACTIONS,
  INVENTORY_ACTION_LABEL,
  activityActionLabel,
  isInventoryAction,
  legacyActionLabel,
} from "../src/lib/inventory-action";
import { itemAttentionState } from "../src/lib/inventory-thresholds";
import { ITEM_TYPES } from "../src/lib/item-type";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
/** A file with its comment lines stripped — a removal may explain itself. */
const codeOf = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const hasCode = (name: string, path: string, needle: string) =>
  ok(name, codeOf(path).includes(needle));
const lacksInCode = (name: string, path: string, needle: string) =>
  ok(name, !codeOf(path).includes(needle));

const section = (title: string) => console.log(`\n── ${title} ──`);

/* ══════════════════════ 1. THE KIT, AND WHAT IT REPORTS ════════════════════ */

const kitItem = (over: Partial<KitItem> & { productId: string }): KitItem => ({
  name: over.productId.toUpperCase(),
  unit: "ea",
  quantity: 4,
  itemType: "COUNTABLE_CONSUMABLE",
  ...over,
});
const kitOf = (...items: KitItem[]): ClockOutKit =>
  new Map(items.map((i) => [i.productId, i]));
const report = (...items: ClosingReport["items"]): ClosingReport => ({ items });
const entries = (v: ClosingReportValidation) => (v.ok ? v.entries : null);
const failCode = (v: ClosingReportValidation) => (v.ok ? null : v.failure.code);

const WINDEX = kitItem({
  productId: "windex",
  name: "Windex",
  unit: "ml",
  quantity: 500,
  itemType: "LIQUID",
});
const GLOVES = kitItem({ productId: "gloves", name: "Gloves", quantity: 4 });
const SCRAPER = kitItem({
  productId: "scraper",
  name: "2-Sided Scraper",
  quantity: 1,
  itemType: "REUSABLE_EQUIPMENT",
});
const KIT = kitOf(WINDEX, GLOVES, SCRAPER);

section("3.2 · each item type reports in its own vocabulary");

check(
  "a liquid reports a LEVEL",
  kindForItemType("LIQUID"),
  "LEVEL"
);
check(
  "a countable consumable reports a COUNT",
  kindForItemType("COUNTABLE_CONSUMABLE"),
  "COUNT"
);
check(
  "reusable equipment reports a CONDITION",
  kindForItemType("REUSABLE_EQUIPMENT"),
  "CONDITION"
);
check(
  "...and every item type has exactly one kind",
  ITEM_TYPES.map(kindForItemType).length,
  new Set(ITEM_TYPES.map(kindForItemType)).size
);

section("3.3 · NOTHING is deducted — the point of the whole stage");

// PDF #2: "no estimated-ml is ever deducted from cleaner inventory on job
// completion; nothing is auto-deducted based on job type."
check(
  "a liquid reported EMPTY leaves the kit count exactly where it was",
  entries(
    validateClosingReport(
      report({ productId: "windex", kind: "LEVEL", levelStatus: "EMPTY" }),
      KIT
    )
  )?.map((e) => [e.productId, e.previousQuantity, e.quantity]),
  [["windex", 500, 500]]
);
check(
  "a tool reported NEEDS_MAINTENANCE moves no quantity anywhere",
  entries(
    validateClosingReport(
      report({
        productId: "scraper",
        kind: "CONDITION",
        condition: "NEEDS_MAINTENANCE",
      }),
      KIT
    )
  )?.map((e) => [e.productId, e.previousQuantity, e.quantity]),
  [["scraper", 1, 1]]
);
check(
  "a count SETS what is left — it is a recount, not a subtraction",
  entries(
    validateClosingReport(
      report({ productId: "gloves", kind: "COUNT", quantity: 1 }),
      KIT
    )
  )?.map((e) => [e.previousQuantity, e.quantity]),
  [[4, 1]]
);
// The old flow's tell: 30 sprays × 1.25 ml = 37.5 deducted. Nothing in the new
// payload can express that, and nothing accepts a spray count.
ok(
  "there is no way to express a spray count at all",
  !JSON.stringify(validateClosingReport(report(), KIT)).includes("spray")
);

section("3.2 · what a cleaner is refused, and what they are not");

check("the No-changes fast path is valid and empty", entries(validateClosingReport(report(), KIT)), []);
check("...as is a missing items list", entries(validateClosingReport({}, KIT)), []);
check("...and a null payload", entries(validateClosingReport(null, KIT)), []);
check(
  "an item that has left the kit is named, with its own code",
  failCode(
    validateClosingReport(report({ productId: "gone", kind: "COUNT", quantity: 1 }), KIT)
  ),
  "PRODUCT_NOT_IN_KIT"
);
check(
  "a condition on a liquid is refused",
  failCode(
    validateClosingReport(
      report({ productId: "windex", kind: "CONDITION", condition: "DAMAGED" }),
      KIT
    )
  ),
  "INVALID_USAGE"
);
check(
  "a level on a tool is refused",
  failCode(
    validateClosingReport(
      report({ productId: "scraper", kind: "LEVEL", levelStatus: "LOW" }),
      KIT
    )
  ),
  "INVALID_USAGE"
);
check(
  "a fractional count is refused",
  failCode(
    validateClosingReport(report({ productId: "gloves", kind: "COUNT", quantity: 2.5 }), KIT)
  ),
  "INVALID_USAGE"
);
check(
  "a negative count is refused",
  failCode(
    validateClosingReport(report({ productId: "gloves", kind: "COUNT", quantity: -1 }), KIT)
  ),
  "INVALID_USAGE"
);
check(
  "an absurd count is refused rather than stored",
  failCode(
    validateClosingReport(
      report({ productId: "gloves", kind: "COUNT", quantity: MAX_KIT_QUANTITY + 1 }),
      KIT
    )
  ),
  "INVALID_USAGE"
);
ok(
  "every refusal names the product the cleaner has to go and fix",
  [
    validateClosingReport(
      report({ productId: "gloves", kind: "COUNT", quantity: -1 }),
      KIT
    ),
    validateClosingReport(
      report({ productId: "windex", kind: "LEVEL", levelStatus: "NOPE" as never }),
      KIT
    ),
  ].every((v) => !v.ok && !!v.failure.field)
);
// A note is trimmed and capped, never dropped and never unbounded.
{
  const long = "x".repeat(1000);
  const v = validateClosingReport(
    report({ productId: "gloves", kind: "COUNT", quantity: 1, note: `  ${long}  ` }),
    KIT
  );
  ok("a note is trimmed and capped", v.ok && v.entries[0].note?.length === 300);
  const blank = validateClosingReport(
    report({ productId: "gloves", kind: "COUNT", quantity: 1, note: "   " }),
    KIT
  );
  ok("...and a whitespace note is null, not an empty string", blank.ok && blank.entries[0].note === null);
}

section("3.3 · which reports raise an admin flag");

// The three vocabularies map onto ONE flag vocabulary. Any value that means
// "an admin should look at this" must produce a flag; the rest must not.
check(
  "liquid levels → flags",
  LIQUID_LEVELS.map((l) => [l, levelFlagType(l)]),
  [
    ["FULL", null],
    ["GOOD", null],
    ["HALF", null],
    ["LOW", "LOW"],
    ["EMPTY", "EMPTY"],
  ]
);
check(
  "countable statuses → flags",
  COUNTABLE_STATUSES.map((s) => [s, countableStatusFlagType(s)]),
  [
    ["OK", null],
    ["LOW", "LOW"],
    ["EMPTY", "EMPTY"],
    ["MISSING", "MISSING"],
    ["DAMAGED", "DAMAGED"],
  ]
);
check(
  "equipment conditions → flags",
  EQUIPMENT_CONDITIONS.map((c) => [c, conditionFlagType(c)]),
  [
    ["AVAILABLE", null],
    ["MISSING", "MISSING"],
    ["DAMAGED", "DAMAGED"],
    ["NEEDS_REPLACEMENT", "NEEDS_REPLACEMENT"],
    ["NEEDS_MAINTENANCE", "NEEDS_MAINTENANCE"],
  ]
);
ok(
  "every flag a report can raise is a real InventoryFlagType",
  [
    ...LIQUID_LEVELS.map(levelFlagType),
    ...COUNTABLE_STATUSES.map(countableStatusFlagType),
    ...EQUIPMENT_CONDITIONS.map(conditionFlagType),
  ]
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .every((t) => (INVENTORY_FLAG_TYPES as readonly string[]).includes(t))
);
// The schema is the authority on the enum; a value added there without a label
// here would render blank in the queue.
{
  const schema = read("prisma/schema.prisma");
  const block = schema.slice(
    schema.indexOf("enum InventoryFlagType {"),
    schema.indexOf("}", schema.indexOf("enum InventoryFlagType {"))
  );
  const declared = block
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
  check("the flag vocabulary mirrors the schema", declared, [...INVENTORY_FLAG_TYPES]);
}

section("3.5 · a reported level is what the badge reads");

// Nothing deducts from a liquid any more, so its COUNT can no longer say
// anything. The reported level has to win, or a bottle a cleaner said was empty
// reads "OK" forever.
check(
  "a full bottle reported EMPTY reads Empty, not OK",
  itemAttentionState({
    itemType: "LIQUID",
    quantity: 500,
    cleanerRestockThreshold: 2,
    defaultThreshold: 2,
    levelStatus: "EMPTY",
  }),
  { kind: "LEVEL", level: "EMPTY", label: "Empty", tone: "critical", needsAttention: true }
);
check(
  "...and one reported HALF is not an alarm",
  itemAttentionState({
    itemType: "LIQUID",
    quantity: 500,
    cleanerRestockThreshold: 2,
    defaultThreshold: 2,
    levelStatus: "HALF",
  }).needsAttention,
  false
);
check(
  "a liquid nobody has reported on falls back to the threshold rule",
  itemAttentionState({
    itemType: "LIQUID",
    quantity: 1,
    cleanerRestockThreshold: 2,
    defaultThreshold: 2,
  }).kind,
  "LOW"
);
// Stage 2's rule is untouched: a scraper is never low, whatever else changed.
check(
  "the scraper from images/page-04-img-1.png is still Available, not Low",
  itemAttentionState({
    itemType: "REUSABLE_EQUIPMENT",
    quantity: 1,
    cleanerRestockThreshold: 2,
    defaultThreshold: 2,
  }).kind,
  "CONDITION"
);

section("3.1 · the stored action retires reason-string matching");

ok(
  "every InventoryAction has a label",
  INVENTORY_ACTIONS.every((a) => !!INVENTORY_ACTION_LABEL[a])
);
{
  const schema = read("prisma/schema.prisma");
  const block = schema.slice(
    schema.indexOf("enum InventoryAction {"),
    schema.indexOf("}", schema.indexOf("enum InventoryAction {"))
  );
  const declared = block
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s/)[0])
    .filter((l) => /^[A-Z_]+$/.test(l));
  check("the action vocabulary mirrors the schema", declared, [...INVENTORY_ACTIONS]);
}
check(
  "a stored action wins over the row's prose",
  activityActionLabel("JOB_REPORT", "Used on job #1826", false),
  INVENTORY_ACTION_LABEL.JOB_REPORT
);
check(
  "a legacy row with no action is still labelled",
  activityActionLabel(null, "Warehouse pickup — Main Warehouse", false),
  "Pickup"
);
// Decision D4: the estimated rows are labelled for what they were, so a
// millilitre figure nobody measured is never read as a count somebody took.
check(
  "...and legacy estimated usage says so",
  legacyActionLabel("Used on job #1826", false),
  "Legacy estimated usage"
);
ok("garbage in the column is not treated as an action", !isInventoryAction("NONSENSE"));

section("3.3 · the log summary an admin reads after a failure");

ok(
  "it names the item and what was reported",
  /Windex → EMPTY/.test(
    describeReportForLog(
      report({ productId: "windex", kind: "LEVEL", levelStatus: "EMPTY" }),
      KIT
    )
  )
);
ok(
  "it says plainly when nothing was reported",
  describeReportForLog(report(), KIT) === "no inventory changes reported"
);
ok(
  "it never echoes the cleaner's free text into an admin-read log",
  !describeReportForLog(
    report({
      productId: "gloves",
      kind: "COUNT",
      quantity: 1,
      note: "<script>alert(1)</script>",
    }),
    KIT
  ).includes("script")
);

/* ═══════════════════════════ 2. THE SOURCE SWEEP ═══════════════════════════ */

section("3.4 · the estimated-usage flow is GONE from both screens");

const BUTTON = "src/app/cleaners/my-jobs/ClockOutButton.tsx";
const SCREEN = "src/app/cleaners/my-jobs/[jobId]/clock/ClockPageClient.tsx";
const SHARED = "src/app/cleaners/my-jobs/ClosingInventoryReport.tsx";
const LIB = "src/lib/clock-out.ts";
const ACTION = "src/app/admin/actions/clockOut.ts";

ok("the shared report component exists", fs.existsSync(SHARED));
for (const [label, path] of [
  ["the job-page button", BUTTON],
  ["the clock screen", SCREEN],
] as const) {
  has(`${label} renders the shared component`, path, "<ClosingInventoryReport");
  // The constants shipped TWICE before this stage, which is how the two screens
  // came to render different footers for the same choice.
  for (const gone of [
    "SPRAY_OPTIONS",
    "MOP_OPTIONS",
    "DISPOSABLE_OPTIONS",
    "ML_PER_SPRAY",
  ]) {
    lacksInCode(`...and no longer declares ${gone}`, path, gone);
  }
}
lacksInCode("the spray constant is gone from the rules module too", LIB, "ML_PER_SPRAY");
lacksInCode("...along with the old usage payload", LIB, "ClockOutUsage");
// The 15-minute resume window and the error taxonomy are Stage 5's work and
// must survive this rewrite untouched.
has("the resume window survives the rewrite", LIB, "CLOCK_OUT_RESUME_WINDOW_MS");
for (const code of ["ALREADY_CLOCKED_OUT", "SYNC_INCOMPLETE", "PRODUCT_NOT_IN_KIT"]) {
  has(`...as does the ${code} error code`, LIB, code);
}

section("3.4 · the two-button gate, and the one-tap fast path");

has("the report asks the PDF's question", SHARED, "Any product levels changed?");
has("...and offers Update inventory", SHARED, "Update inventory");
for (const [label, path] of [
  ["the job-page button", BUTTON],
  ["the clock screen", SCREEN],
] as const) {
  has(`${label} offers the No-changes fast path`, path, "No changes — clock out");
}
// The property that makes "only what changed is submitted" true rather than a
// promise: a row with no answer is not in the payload at all.
has("only answered rows are submitted", SHARED, "if (!isAnswered(draft)) continue;");
has("...and rows start blank rather than pre-seeded", SHARED,
  'return { kind: "CONDITION", condition: null, note: "" };');
// A cleared number box means "I didn't count it", never zero.
has("a cleared count is not read as zero", SHARED, 'trimmed === "" ? null : Number(trimmed)');

section("3.3 · what the server writes now");

hasCode("the report is validated before anything is touched", ACTION, "validateClosingReport(report, kit)");
hasCode("the kit row records the reported status", ACTION, "statusUpdatedAt: now,");
hasCode("...history carries previous → new status", ACTION, "previousStatus,");
hasCode("...tagged with the stored action", ACTION, 'action: "JOB_REPORT",');
hasCode("...and the job it was reported on", ACTION, "Reported at clock-out on job #");
hasCode("a problem opens an admin flag", ACTION, "db.inventoryFlag.createMany({");
hasCode("...sourced as CLOCK_OUT, with the job", ACTION, 'source: "CLOCK_OUT",');
hasCode("...de-duped against what is already open", ACTION, "flagsToCreate");
hasCode("...and stale flags are closed when the cleaner says it is fine", ACTION, 'status: "RESOLVED"');
// The removals.
lacksInCode("no estimated usage row is written", ACTION, "jobProductUsage");
lacksInCode("no supplies transaction is created", ACTION, "db.transaction.create(");
lacksInCode("...so no budget category is resolved", ACTION, "requireBudgetCategoryId");
// Everything that is NOT the inventory branch must survive.
for (const [label, needle] of [
  ["the session close", "db.jobWorkSession.update({"],
  ["the break close", "db.jobBreak.updateMany({"],
  ["the wash projection", "washProjectedRags: projection.projectedRags"],
  ["the resume path", "findRecentlyClosedSession"],
  ["the failure log", "CLOCK_OUT_FAILED"],
] as const) {
  has(`${label} is untouched`, ACTION, needle);
}
// One transaction, still — it is what makes Retry safe.
check(
  "the writes are still ONE transaction",
  (read(ACTION).match(/db\.\$transaction\(/g) ?? []).length,
  1
);

section("3.4 · the checklist gate still blocks clock-out");

has("the job-page button still gates on required items", BUTTON, "pendingRequiredItems(checklistItems)");
has("the clock screen still gates on required items", SCREEN, "requiredItemsSatisfied(checklistItems)");

section("3.5 · what the admin can see");

const HUB = "src/app/admin/inventory/InventoryPageClient.tsx";
const ATTENTION = "src/app/admin/inventory/AttentionView.tsx";
const KITS = "src/app/admin/inventory/CleanerInventoryView.tsx";
const ACTIVITY = "src/app/admin/inventory/ActivityView.tsx";
const READER = "src/app/admin/actions/getInventoryActivity.ts";
const FLAG_ACTION = "src/app/admin/actions/resolveInventoryFlag.ts";

ok("the attention queue exists", fs.existsSync(ATTENTION));
has("...and is a tab in the inventory hub", HUB, 'id: "attention"');
has("...badged with the open count", HUB, "badge: attentionFlags.length");
for (const [label, needle] of [
  ["type", "All types"],
  ["cleaner", "All cleaners"],
  ["product", "All products"],
] as const) {
  has(`the queue filters by ${label}`, ATTENTION, needle);
}
has("the queue can resolve a flag", ATTENTION, 'decide(flag.id, "RESOLVED")');
has("...dismiss one", ATTENTION, 'decide(flag.id, "DISMISSED")');
has("...and create a restock request", ATTENTION, "createRestockRequestFromFlag");
has("resolving is gated to admins", FLAG_ACTION, "requireInventoryAdmin()");
has("...a resolved flag records who and when", FLAG_ACTION, "resolvedById: guard.actor.id");
has("a restock goes through the EXISTING approval queue", FLAG_ACTION, "db.inventoryRequest.create({");
has("...and cannot double-file one", FLAG_ACTION, 'status: "PENDING",');

has("the kit tab shows the latest reported status", KITS, "statusLabel(i.lastReport.newStatus)");
has("...with the transition it came from", KITS, "i.lastReport.previousStatus");
has("...the job it was reported on", KITS, "jobRef(i.lastReport.reason)");
has("...and any flag still open against it", KITS, "INVENTORY_FLAG_LABEL[t]");

has("the activity log renders status transitions", ACTIVITY, "statusLabel(e.newStatus)");
has("...and reads the stored action", READER, "activityActionLabel(r.action, r.reason");
lacksInCode("...instead of pattern-matching the reason", READER, "function deriveAction");

section("3.1 · every writer records what it did");

// The whole point of the action column: a verb decided by the code that knows
// the answer. A writer that forgets it silently falls back to prose-reading.
const WRITERS: Array<[string, string]> = [
  ["src/app/admin/actions/assignKit.ts", 'action: "ASSIGN"'],
  ["src/app/admin/actions/assignToCleanerKit.ts", 'action: "ASSIGN"'],
  ["src/app/admin/actions/bulkAssignCleanerInventory.ts", 'action: mode === "FROM_LOCKER"'],
  ["src/app/admin/actions/checkoutInventory.ts", 'action: "PICKUP"'],
  ["src/app/admin/actions/resolveInventoryRequest.ts", 'action: "REQUEST_FULFILLED"'],
  ["src/app/admin/actions/reportDamagedItem.ts", 'action: "ISSUE"'],
  ["src/app/admin/actions/setCleanerProductQuantity.ts", 'action: "ADMIN_SET"'],
  ["src/app/admin/actions/updateMyInventoryCount.ts", 'action: "RECOUNT"'],
  ["src/app/admin/actions/updateMyItemCondition.ts", 'action: "STATUS_REPORT"'],
  ["src/app/admin/actions/updateProduct.ts", 'action: "ADMIN_SET"'],
  ["src/app/cleaners/my-inventory/addMyInventoryItem.ts", 'action: "RECOUNT"'],
  ["src/app/admin/actions/clockOut.ts", 'action: "JOB_REPORT"'],
  // Stage 4: the single writer for the warehouse side of every movement. Its
  // verb is passed in by the caller rather than hard-coded, which is the point
  // — one place writes the row, each caller says what it was doing.
  ["src/lib/stock.server.ts", "action: args.action"],
];
for (const [path, needle] of WRITERS) {
  has(`${path.split("/").pop()} records its action`, path, needle);
}
// THE sweep. The list above is only as good as its completeness, so this walks
// the whole tree for `inventoryChange.create*` and fails on any file that isn't
// in it — a writer added next month cannot quietly go back to being labelled by
// pattern-matching its own prose.
{
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  const known = new Set(WRITERS.map(([p]) => p));
  const unlisted = walk("src").filter(
    (f) =>
      /inventoryChange\.create(Many)?\(/.test(codeOf(f)) &&
      !known.has(f.replace(/\\/g, "/"))
  );
  check("no InventoryChange writer is missing from the list above", unlisted, []);
}

section("3.6 · the estimated-usage remnants");

// D3 — the forecast is hidden, not deleted, and hidden on BOTH surfaces.
has("the forecast switch exists", "src/lib/inventory-forecast.flag.ts", "INVENTORY_FORECAST_ENABLED");
ok(
  "...and is off",
  /INVENTORY_FORECAST_ENABLED = false/.test(read("src/lib/inventory-forecast.flag.ts"))
);
has("the hub honours it", HUB, "INVENTORY_FORECAST_ENABLED");
has("the employee page honours it", "src/app/admin/employees/[id]/page.tsx", "INVENTORY_FORECAST_ENABLED");
ok("the forecast view itself is kept, not deleted", fs.existsSync("src/app/admin/inventory/ForecastView.tsx"));
ok("...as is the projection maths", fs.existsSync("src/lib/inventory-forecast.ts"));

// D4 — legacy rows stay readable and are labelled.
has("the job's product table says what those rows were",
  "src/app/admin/jobs/[id]/JobDetailView.tsx", "Legacy estimated usage");
has("...and points at where reports live now",
  "src/app/admin/jobs/[id]/JobDetailView.tsx", "Needs Attention");

// The dead model is gone, with a migration.
lacksInCode("the InventoryRule model is gone", "prisma/schema.prisma", "model InventoryRule {");
ok(
  "...with a drop migration",
  fs.existsSync("prisma/migrations/20260817020000_drop_inventory_rule/migration.sql")
);
ok(
  "the action column has a migration too",
  fs.existsSync("prisma/migrations/20260817010000_add_inventory_action/migration.sql")
);
has("...adding the enum", "prisma/migrations/20260817010000_add_inventory_action/migration.sql",
  'CREATE TYPE "InventoryAction"');
has("...and the nullable column", "prisma/migrations/20260817010000_add_inventory_action/migration.sql",
  'ADD COLUMN "action" "InventoryAction";');

section("3.7 · the record");

has("CHANGES.md §4 points at what replaced it", "docs/reference/CHANGES.md", "SUPERSEDED");
has("...naming the new component", "docs/reference/CHANGES.md", "ClosingInventoryReport.tsx");
ok("the owner-facing note exists", fs.existsSync("docs/reference/INVENTORY_REPORTING_CHANGE.md"));
for (const d of ["D2", "D3", "D4"]) {
  has(`...and records decision ${d}`, "docs/reference/INVENTORY_REPORTING_CHANGE.md", `**${d}**`);
}

/* ═══════════════════════════════════════════════════════════════════════════ */

// Belt and braces on the label helper the admin surfaces lean on: three
// vocabularies share four values, and they must read the same in all of them.
for (const shared of ["LOW", "EMPTY", "MISSING", "DAMAGED"]) {
  ok(`"${shared}" has one unambiguous label`, !!statusLabel(shared));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
