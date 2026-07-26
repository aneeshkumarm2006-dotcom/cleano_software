// Verification for fix list items 6 + 13 (+ 17's "Assign more").
// Pure quantity semantics + structural checks. No DB access, no writes.
import fs from "node:fs";
import { resolveAssignedQuantity } from "../src/lib/inventory-assign";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  ok ? pass++ : fail++;
}
function ok(name: string, cond: boolean) { check(name, cond, true); }

// ── FROM_LOCKER: the number is an amount to hand over ──────────────────────
check("from locker: adds to what the cleaner already holds",
  resolveAssignedQuantity("FROM_LOCKER", 3, 2), { after: 5, delta: 2, companyDelta: -2 });
check("from locker: works from an empty kit",
  resolveAssignedQuantity("FROM_LOCKER", 0, 4), { after: 4, delta: 4, companyDelta: -4 });
check("from locker: company stock always moves by the amount given",
  resolveAssignedQuantity("FROM_LOCKER", 10, 1.5), { after: 11.5, delta: 1.5, companyDelta: -1.5 });

// ── MANUAL_ADJUST: the number is the new absolute count ────────────────────
check("manual adjust: sets the count, not a delta",
  resolveAssignedQuantity("MANUAL_ADJUST", 3, 2), { after: 2, delta: -1, companyDelta: 0 });
check("manual adjust: NEVER touches company stock",
  resolveAssignedQuantity("MANUAL_ADJUST", 3, 99).companyDelta, 0);
check("manual adjust: zero clears the kit row",
  resolveAssignedQuantity("MANUAL_ADJUST", 6, 0), { after: 0, delta: -6, companyDelta: 0 });
check("manual adjust: same value is a no-op delta",
  resolveAssignedQuantity("MANUAL_ADJUST", 5, 5), { after: 5, delta: 0, companyDelta: 0 });

// The two modes must genuinely differ for the same typed number.
const a = resolveAssignedQuantity("FROM_LOCKER", 3, 2);
const b = resolveAssignedQuantity("MANUAL_ADJUST", 3, 2);
ok("the same input means different things per mode", a.after !== b.after);

// Float noise must not reach stored quantities.
check("fractional units round to cents",
  resolveAssignedQuantity("FROM_LOCKER", 0.1, 0.2).after, 0.3);

// ── Structural checks on the action + UI ───────────────────────────────────
const action = fs.readFileSync("src/app/admin/actions/bulkAssignCleanerInventory.ts", "utf8");
ok("action is admin-guarded", action.includes("requireOwnerAdmin"));
ok("action rejects non-staff kit targets", action.includes('role: { in: ["EMPLOYEE"'));
ok("action rejects duplicate product lines", action.includes("listed twice"));
ok("action requires a location for FROM_LOCKER", action.includes("Choose the location"));
ok("company stock is only touched in FROM_LOCKER",
  /if \(mode === "FROM_LOCKER"\) \{[\s\S]*?product\.update/.test(action));
ok("kit + warehouse audit rows are written", (action.match(/inventoryChange\.create/g) || []).length >= 2);
ok("bulk save runs in one transaction", action.includes("db.$transaction"));
ok("locker may go negative rather than blocking", action.includes("inventoryLocationStock.upsert"));

const modal = fs.readFileSync("src/app/admin/inventory/QuickAssignModal.tsx", "utf8");
ok("UI offers both modes", modal.includes("From locker") && modal.includes("Manual adjust"));
ok("UI clears typed values when the mode changes", modal.includes("switchMode"));
ok("UI refreshes so the kit updates immediately", modal.includes("router.refresh()"));

const view = fs.readFileSync("src/app/admin/inventory/CleanerInventoryView.tsx", "utf8");
ok("cleaner rows have an 'Assign more' button", view.includes("Assign more"));
ok("empty state is not a dead end", view.includes("Assign inventory"));

const page = fs.readFileSync("src/app/admin/inventory/page.tsx", "utf8");
ok("assign list uses ALL cleaners, not only those holding stock",
  page.includes("const assignCleaners = employees.map"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
