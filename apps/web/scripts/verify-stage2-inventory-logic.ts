// Verification for STAGE 2 of `_ai_context/TODO.md` —
// low-stock & condition logic per item type
// (cleano_inventory_operations_fixes.pdf #4 + the "tools should not show as
// Low" bullets of #1).
//
// Run: npx tsx scripts/verify-stage2-inventory-logic.ts
//
// Two halves, same as the other verify-* scripts in this repo:
//   1. The PURE rules, exercised directly — including the exact scraper from
//      images/page-04-img-1.png.
//   2. A SOURCE SWEEP proving no surface re-derives "is this low?" for itself,
//      and that every server call site now passes the threshold default.
//
// The DB is never touched: Stage 1's migration is still deferred, so these
// checks have to hold on code alone.

import fs from "node:fs";
import {
  cleanerRestockThreshold,
  isCleanerLow,
  itemAttentionState,
  tracksRefill,
} from "../src/lib/inventory-thresholds";
import {
  DEFAULT_EQUIPMENT_CONDITION,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_CONDITION_LABEL,
  INVENTORY_FLAG_TYPES,
  LIQUID_LEVELS,
  conditionFlagType,
  conditionNeedsAttention,
  isEquipmentCondition,
} from "../src/lib/inventory-status";

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

const read = (p: string) => fs.readFileSync(p, "utf8");
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));

/* ══════════════════ 1. THE DEFECT THE PDF SCREENSHOT SHOWS ═════════════════ */
// p.4: "2-Sided Scraper — LOW — Running low (1 Scrapers left) — request a
// refill." A cleaner needs exactly one scraper. It must never read as low.

const SCRAPER = {
  cleanerRestockThreshold: 2,
  defaultThreshold: 2,
  itemType: "REUSABLE_EQUIPMENT" as const,
};

ok(
  "a cleaner holding 1 scraper is NOT low",
  !isCleanerLow(1, SCRAPER)
);
ok(
  "...not even at zero, and not at any threshold",
  !isCleanerLow(0, SCRAPER) &&
    !isCleanerLow(1, { ...SCRAPER, cleanerRestockThreshold: 99 })
);
check(
  "...and it reports a CONDITION instead",
  itemAttentionState({ ...SCRAPER, quantity: 1 }),
  {
    kind: "CONDITION",
    condition: "AVAILABLE",
    label: "Available",
    tone: "ok",
    needsAttention: false,
  }
);
ok(
  "a scraper in good order does not count toward NEEDS ATTENTION",
  itemAttentionState({ ...SCRAPER, quantity: 1 }).needsAttention === false
);

// The same product held by a cleaner who reported a problem.
for (const condition of EQUIPMENT_CONDITIONS) {
  const state = itemAttentionState({ ...SCRAPER, quantity: 1, condition });
  check(
    `condition ${condition} renders as "${EQUIPMENT_CONDITION_LABEL[condition]}"`,
    state.kind === "CONDITION" && state.label,
    EQUIPMENT_CONDITION_LABEL[condition]
  );
  check(
    `...and needs attention: ${conditionNeedsAttention(condition)}`,
    state.needsAttention,
    condition !== "AVAILABLE"
  );
}

// A tool a cleaner no longer holds is missing, whatever the label says.
check(
  "equipment at quantity 0 with no report reads as MISSING",
  itemAttentionState({ ...SCRAPER, quantity: 0 }).kind === "CONDITION" &&
    (itemAttentionState({ ...SCRAPER, quantity: 0 }) as { condition: string })
      .condition,
  "MISSING"
);
// ...but an explicit report always wins over the quantity guess.
check(
  "an explicit condition beats the zero-quantity guess",
  (
    itemAttentionState({
      ...SCRAPER,
      quantity: 0,
      condition: "NEEDS_REPLACEMENT",
    }) as { condition: string }
  ).condition,
  "NEEDS_REPLACEMENT"
);
check(
  "an unreported tool defaults to Available, not to a problem",
  DEFAULT_EQUIPMENT_CONDITION,
  "AVAILABLE"
);

/* ═══════════════════ 2. CONSUMABLES KEEP TODAY'S BEHAVIOR ══════════════════ */

const WINDEX = {
  cleanerRestockThreshold: 2,
  defaultThreshold: 2,
  itemType: "LIQUID" as const,
};
const GLOVES = { ...WINDEX, itemType: "COUNTABLE_CONSUMABLE" as const };

check("a liquid at 2 with threshold 2 is LOW", itemAttentionState({ ...WINDEX, quantity: 2 }).kind, "LOW");
check("a liquid at 3 is OK", itemAttentionState({ ...WINDEX, quantity: 3 }).kind, "OK");
check("a liquid at 0 is EMPTY", itemAttentionState({ ...WINDEX, quantity: 0 }).kind, "EMPTY");
check("a countable at 1 with threshold 2 is LOW", itemAttentionState({ ...GLOVES, quantity: 1 }).kind, "LOW");
ok("both consumable types still use refill thresholds",
  tracksRefill("LIQUID") && tracksRefill("COUNTABLE_CONSUMABLE"));
ok("equipment does not", !tracksRefill("REUSABLE_EQUIPMENT"));
// Callers that predate Stage 1 (no itemType at hand) must be unchanged.
ok("an omitted itemType keeps the pre-Stage-1 answer",
  isCleanerLow(2, { cleanerRestockThreshold: 2 }));

/* ══════════ 3. THE THRESHOLD DEFAULT: ADMIN AND CLEANER MUST AGREE ═════════ */
// With the setting on its default of 2 and no per-product value, a cleaner
// holding 2 is low. Any surface that omits the setting answers 1 and says OK —
// which is the disagreement Stage 2.2 exists to end.

const noProductValue = { cleanerRestockThreshold: 0 };
check("omitting the setting silently drops the threshold to 1",
  cleanerRestockThreshold(noProductValue), 1);
check("...passing it gives the admin's number",
  cleanerRestockThreshold({ ...noProductValue, defaultThreshold: 2 }), 2);
ok("...and that is the difference between Low and OK for a cleaner holding 2",
  !isCleanerLow(2, noProductValue) &&
    isCleanerLow(2, { ...noProductValue, defaultThreshold: 2 }));

/* ════════════════════════ 4. FLAG MAPPING IS ONE RULE ══════════════════════ */

check("Available raises no flag", conditionFlagType("AVAILABLE"), null);
check("Missing raises MISSING", conditionFlagType("MISSING"), "MISSING");
check("Damaged raises DAMAGED", conditionFlagType("DAMAGED"), "DAMAGED");
check("Needs replacement raises NEEDS_REPLACEMENT",
  conditionFlagType("NEEDS_REPLACEMENT"), "NEEDS_REPLACEMENT");
check("Needs maintenance raises NEEDS_MAINTENANCE",
  conditionFlagType("NEEDS_MAINTENANCE"), "NEEDS_MAINTENANCE");
ok("every non-Available condition maps to a real flag type",
  EQUIPMENT_CONDITIONS.filter((c) => c !== "AVAILABLE").every((c) =>
    (INVENTORY_FLAG_TYPES as readonly string[]).includes(
      conditionFlagType(c) as string
    )
  ));
ok("the condition guard rejects junk",
  !isEquipmentCondition("BROKEN") && !isEquipmentCondition(null) &&
    isEquipmentCondition("DAMAGED"));

/* ═════════ 5. THE MIRRORED VOCABULARIES MATCH prisma/schema.prisma ═════════ */
// src/lib/inventory-status.ts mirrors three Prisma enums as string unions so
// client components don't have to import the generated client. If the schema
// grows a value and the mirror doesn't, a cleaner can report a state no screen
// can render — assert they stay in step.

const schema = read("prisma/schema.prisma");
function enumValues(name: string): string[] {
  const m = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}
check("EquipmentCondition mirror matches the schema",
  [...EQUIPMENT_CONDITIONS].sort(), enumValues("EquipmentCondition").sort());
check("LiquidLevel mirror matches the schema",
  [...LIQUID_LEVELS].sort(), enumValues("LiquidLevel").sort());
check("InventoryFlagType mirror matches the schema",
  [...INVENTORY_FLAG_TYPES].sort(), enumValues("InventoryFlagType").sort());

/* ═════════════════ 6. SOURCE SWEEP: ONE RULE, EVERY SURFACE ════════════════ */

const THRESHOLDS = "src/lib/inventory-thresholds.ts";
has("isCleanerLow short-circuits on item type", THRESHOLDS,
  "if (p.itemType && !usesRefillThresholds(p.itemType)) return false;");
has("itemAttentionState is the shared classifier", THRESHOLDS,
  "export function itemAttentionState(");

// Every server surface that judges a kit passes the admin's default. These are
// the exact five the TODO lists, plus the two forecast blocks on the same pages.
const KIT_SURFACES: Array<[string, string]> = [
  ["the cleaner's My Inventory", "src/app/cleaners/my-inventory/page.tsx"],
  ["the admin Inventory hub", "src/app/admin/inventory/page.tsx"],
  ["the employee detail page", "src/app/admin/employees/[id]/page.tsx"],
  ["the admin dashboard", "src/app/admin/dashboard/page.tsx"],
  ["the cleaner dashboard", "src/app/admin/dashboard/CleanerDashboard.tsx"],
  ["clock-out", "src/app/admin/actions/clockOut.ts"],
  ["the product detail page", "src/app/admin/inventory/[id]/page.tsx"],
];
for (const [label, path] of KIT_SURFACES) {
  has(`${label} loads the admin's threshold default`, path,
    "loadCleanerThresholdDefault");
}

// Every surface that judges a kit passes the item type, so equipment is
// excluded from "low" at the source rather than filtered out downstream.
for (const [label, path] of KIT_SURFACES) {
  has(`${label} passes the item type`, path, "itemType");
}

// The setting key lives in exactly one place now.
const settingReaders = KIT_SURFACES.filter(([, p]) =>
  read(p).includes('"inventory.defaultRefillThreshold"')
);
check("no surface reads the setting key directly any more",
  settingReaders.map(([l]) => l), []);
has("the server wrapper owns the key",
  "src/lib/inventory-thresholds.server.ts", '"inventory.defaultRefillThreshold"');

// The exact string from images/page-04-img-1.png must be unreachable for a tool.
const MY_INV_CLIENT = "src/app/cleaners/my-inventory/MyInventoryClient.tsx";
has("the refill copy is gated on the consumable branch", MY_INV_CLIENT,
  "const needsRefill = !equipment && (item.isLow || item.isOutOfStock);");
has("equipment gets Update condition instead of Request refill", MY_INV_CLIENT,
  "Update condition");
has("the badge comes from the shared state, not a local ternary", MY_INV_CLIENT,
  "{item.attention.label}");
lacks("...and the old Empty/Low/OK ternary is gone", MY_INV_CLIENT,
  '{item.isOutOfStock ? "Empty" : item.isLow ? "Low" : "OK"}');
has("the hero count is the shared attention count", MY_INV_CLIENT,
  "items.filter((i) => i.attention.needsAttention).length");

// Risk note in the TODO: don't repurpose `.cl-pill.low` for conditions.
const CSS = "src/app/globals.css";
has("condition pills have their own classes", CSS, ".cl-pill.cond-alert");
ok("...and the consumable pills are untouched",
  read(CSS).includes(".cl-pill.low        {") &&
    read(CSS).includes(".cl-pill.empty      {"));

// Admin surfaces consume the same state object.
for (const [label, path] of [
  ["the Cleaner Inventory tab", "src/app/admin/inventory/CleanerInventoryView.tsx"],
  ["the employee products tab", "src/app/admin/employees/[id]/EmployeeDetailView.tsx"],
  ["the product detail assignments", "src/app/admin/inventory/[id]/ProductDetailView.tsx"],
] as const) {
  has(`${label} renders the shared attention state`, path, "attention.label");
  has(`...${label} does not invent its own tone`, path, "attention.tone");
}

// 2.6 — an issue report against a tool is also a condition report.
const DAMAGE = "src/app/admin/actions/reportDamagedItem.ts";
has("issue reports set the equipment condition", DAMAGE, "ISSUE_CONDITION[issue]");
// `tx.`, not `db.`, since Stage 4 moved this into the interactive transaction
// so the flag lookup and the warehouse write-off share it.
has("...open an admin review flag", DAMAGE, "tx.inventoryFlag.create({");
has("...de-duped against what is already open", DAMAGE, 'status: "OPEN",');
has("...and record the status transition", DAMAGE, "previousStatus:");
has("the existing write-off rule is untouched", DAMAGE,
  "const writeOff = writesOffCompanyStock(issue);");

// 2.3 — the cleaner's condition action.
const COND = "src/app/admin/actions/updateMyItemCondition.ts";
has("the condition action writes the kit row", COND, "tx.employeeProduct.update({");
has("...with previous → new status history", COND, "previousStatus: previous,");
has("...opens a flag for anything but Available", COND, "tx.inventoryFlag.create({");
has("...and resolves stale flags when it is fine again", COND,
  "tx.inventoryFlag.updateMany({");
lacks("...and never moves a quantity", COND, "quantity:");

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
