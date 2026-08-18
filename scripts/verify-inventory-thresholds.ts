// Verification for fix list item 14 — split inventory refill thresholds.
// Pure rules + a source sweep proving the two thresholds can't be swapped.
import fs from "node:fs";
import {
  DEFAULT_CLEANER_RESTOCK_THRESHOLD,
  cleanerRestockThreshold,
  companyReorderThreshold,
  isCleanerLow,
  isCompanyLow,
  usesDefaultCleanerThreshold,
  LOW_STOCK_LABEL,
} from "../src/lib/inventory-thresholds";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

// ── The defect this item exists to fix ─────────────────────────────────────
// Warehouse reorders at 20; a cleaner carries 3. The cleaner must NOT be
// judged against 20.
const product = { minStock: 20, stockLevel: 50, cleanerRestockThreshold: 2 };
check("company threshold is minStock", companyReorderThreshold(product), 20);
check("cleaner threshold is its own field", cleanerRestockThreshold(product), 2);
ok("cleaner holding 3 is NOT low against a company reorder point of 20",
  !isCleanerLow(3, product));
ok("cleaner holding 2 IS low against their own threshold of 2",
  isCleanerLow(2, product));

// Company stock is judged only by its own threshold.
ok("company stock 50 vs reorder 20 is fine", !isCompanyLow(product));
ok("company stock 20 vs reorder 20 needs purchasing",
  isCompanyLow({ minStock: 20, stockLevel: 20 }));
ok("a 0 company threshold never alerts",
  !isCompanyLow({ minStock: 0, stockLevel: 0 }));

// ── Cleaner default when unset ─────────────────────────────────────────────
const unset = { cleanerRestockThreshold: 0 };
ok("unset cleaner threshold falls back, not to zero", cleanerRestockThreshold(unset) > 0);
ok("unset is reported as using the default", usesDefaultCleanerThreshold(unset));
// The "fallback covers one more job when usage is known" case is GONE with the
// InventoryRule.usagePerJob floor (awerfixes.pdf round 3, item 14). That term
// raised every cleaner's threshold to a number an admin typed into Settings
// once, so a stale guess decided when everyone was warned — and a product with
// no rule got no floor at all. Two maintained knobs remain, asserted below.
check("admin's global default is honoured",
  cleanerRestockThreshold({ cleanerRestockThreshold: 0, defaultThreshold: 5 }), 5);
check("a configured product value beats the global default",
  cleanerRestockThreshold({ cleanerRestockThreshold: 2, defaultThreshold: 5 }), 2);
check("with neither configured, the built-in default applies",
  cleanerRestockThreshold({ cleanerRestockThreshold: 0 }),
  DEFAULT_CLEANER_RESTOCK_THRESHOLD);
ok("a configured value is not reported as default",
  !usesDefaultCleanerThreshold({ cleanerRestockThreshold: 2 }));

// ── Alerts must name the action ────────────────────────────────────────────
check("company alert names purchasing", LOW_STOCK_LABEL.COMPANY_PURCHASE, "Company needs to purchase");
check("cleaner alert names restocking", LOW_STOCK_LABEL.CLEANER_RESTOCK, "Cleaner needs restock");

// ── Source sweep: no cleaner-side path may read the company threshold ──────
const read = (p: string) => fs.readFileSync(p, "utf8");

const clockOut = read("src/app/admin/actions/clockOut.ts");
ok("clockOut no longer falls back to minStock", !clockOut.includes("?? ep.product.minStock"));
ok("clockOut uses the cleaner threshold rule", clockOut.includes("isCleanerLow"));

const myInv = read("src/app/cleaners/my-inventory/page.tsx");
// The cleaner app moved from calling isCleanerLow() directly to calling
// itemAttentionState(), which calls it internally (Stage 2 of
// `_ai_context/TODO.md`). That is a STRONGER guarantee, not a weaker one: the
// shared helper is also what decides that a reusable tool has no "low" state at
// all, so a screen calling isCleanerLow() by hand is now the thing to catch.
ok("cleaner app uses the shared attention rule",
  myInv.includes("itemAttentionState("));
ok("...and does not hand-roll a second low rule",
  !myInv.includes("isCleanerLow("));
ok("cleaner app never reads minStock", !myInv.includes("minStock"));

const dash = read("src/app/admin/dashboard/page.tsx");
ok("admin dashboard refill alert uses the cleaner rule", dash.includes("isCleanerLow"));
const cdash = read("src/app/admin/dashboard/CleanerDashboard.tsx");
ok("cleaner dashboard uses the cleaner rule", cdash.includes("isCleanerLow"));
ok("cleaner dashboard no longer skips products lacking a rule",
  !cdash.includes("if (!rule) return false"));

const invPage = read("src/app/admin/inventory/page.tsx");
ok("admin inventory judges company stock with isCompanyLow", invPage.includes("isCompanyLow(product)"));
ok("admin inventory judges kits with isCleanerLow", invPage.includes("isCleanerLow(ep.quantity"));

const modal = read("src/app/admin/inventory/ProductModal.tsx");
ok("product editor exposes both thresholds by name",
  modal.includes("Company Reorder Threshold") && modal.includes("Cleaner Restock Threshold"));

// The legacy Inventory Rules editor used to co-write cleanerRestockThreshold,
// and this asserted it stayed in step. Both actions are deleted (item 14), so
// ProductModal above is now the only writer — which is the check that matters.
// Assert the removal instead, so the tab cannot quietly come back.
ok("the legacy rule editor is gone",
  !fs.existsSync("src/app/admin/actions/updateInventoryRule.ts") &&
  !fs.existsSync("src/app/admin/actions/createInventoryRule.ts"));

const view = read("src/app/admin/inventory/InventoryView.tsx");
ok("company badge says purchase", view.includes("Purchase needed"));
const cview = read("src/app/admin/inventory/CleanerInventoryView.tsx");
ok("cleaner badge says restock", cview.includes("Restock needed"));

const migration = read("prisma/migrations/20260726000000_split_inventory_thresholds/migration.sql");
ok("migration adds the column", migration.includes('ADD COLUMN "cleanerRestockThreshold"'));
ok("migration backfills existing configured thresholds", migration.includes("UPDATE \"Product\" p"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
