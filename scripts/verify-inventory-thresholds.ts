// Verification for fix list item 14 — split inventory refill thresholds.
// Pure rules + a source sweep proving the two thresholds can't be swapped.
import fs from "node:fs";
import {
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
const unset = { cleanerRestockThreshold: 0, usagePerJob: 0 };
ok("unset cleaner threshold falls back, not to zero", cleanerRestockThreshold(unset) > 0);
ok("unset is reported as using the default", usesDefaultCleanerThreshold(unset));
check("fallback covers one more job when usage is known",
  cleanerRestockThreshold({ cleanerRestockThreshold: 0, usagePerJob: 4 }), 4);
check("admin's global default is honoured",
  cleanerRestockThreshold({ cleanerRestockThreshold: 0, usagePerJob: 0, defaultThreshold: 5 }), 5);
check("a configured product value beats the global default",
  cleanerRestockThreshold({ cleanerRestockThreshold: 2, usagePerJob: 0, defaultThreshold: 5 }), 2);
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
ok("cleaner app uses the cleaner threshold rule", myInv.includes("isCleanerLow"));
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

const rules = read("src/app/admin/actions/updateInventoryRule.ts");
ok("legacy rule editor writes the authoritative field too",
  rules.includes("cleanerRestockThreshold: refillThreshold"));

const view = read("src/app/admin/inventory/InventoryView.tsx");
ok("company badge says purchase", view.includes("Purchase needed"));
const cview = read("src/app/admin/inventory/CleanerInventoryView.tsx");
ok("cleaner badge says restock", cview.includes("Restock needed"));

const migration = read("prisma/migrations/20260726000000_split_inventory_thresholds/migration.sql");
ok("migration adds the column", migration.includes('ADD COLUMN "cleanerRestockThreshold"'));
ok("migration backfills existing configured thresholds", migration.includes("UPDATE \"Product\" p"));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
