// Verification for fix list item 15 — cleaner inventory issue reporting.
import fs from "node:fs";
import {
  INVENTORY_ISSUE_TYPES,
  ISSUE_HINT,
  ISSUE_LABEL,
  issueAuditReason,
  isInventoryIssueType,
  needsRestock,
  normalizeIssueType,
  writesOffCompanyStock,
} from "../src/lib/inventory-issues";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

// ── The four types the spec names ──────────────────────────────────────────
check("exactly the four required issue types",
  [...INVENTORY_ISSUE_TYPES], ["LOST", "BROKEN", "RAN_OUT", "OTHER"]);
check("Lost label", ISSUE_LABEL.LOST, "Lost");
check("Broken label", ISSUE_LABEL.BROKEN, "Broken");
check("Ran out label", ISSUE_LABEL.RAN_OUT, "Ran out");
check("Other label", ISSUE_LABEL.OTHER, "Other");
ok("every type has a hint",
  INVENTORY_ISSUE_TYPES.every((t) => ISSUE_HINT[t]?.length > 0));

// ── The types must NOT be treated identically ──────────────────────────────
// Genuine loss is written off company stock.
ok("Lost writes off company stock", writesOffCompanyStock("LOST"));
ok("Broken writes off company stock", writesOffCompanyStock("BROKEN"));
// "Ran out" is consumption — company stock already dropped when it was handed
// over, so writing it off again would double-count the loss.
ok("Ran out does NOT write off company stock again", !writesOffCompanyStock("RAN_OUT"));
// "Other" is unexplained — never silently reduce what the company owns.
ok("Other does NOT write off company stock", !writesOffCompanyStock("OTHER"));
ok("only Ran out signals a restock",
  needsRestock("RAN_OUT") &&
  !needsRestock("LOST") && !needsRestock("BROKEN") && !needsRestock("OTHER"));

// ── Audit trail wording ────────────────────────────────────────────────────
check("audit reason without a note",
  issueAuditReason("RAN_OUT"), "Ran out — reported by cleaner");
check("audit reason includes the note",
  issueAuditReason("BROKEN", "handle snapped"),
  "Broken — reported by cleaner: handle snapped");
check("blank note is ignored", issueAuditReason("LOST", "   "), "Lost — reported by cleaner");

// ── Legacy values still resolve ────────────────────────────────────────────
check("legacy 'lost' maps to LOST", normalizeIssueType("lost"), "LOST");
check("legacy 'damaged' maps to BROKEN", normalizeIssueType("damaged"), "BROKEN");
check("a valid type passes through", normalizeIssueType("RAN_OUT"), "RAN_OUT");
check("garbage falls back to OTHER, not a write-off type",
  normalizeIssueType("nonsense"), "OTHER");
ok("OTHER fallback can never write off stock",
  !writesOffCompanyStock(normalizeIssueType(undefined)));
ok("type guard rejects junk",
  isInventoryIssueType("LOST") && !isInventoryIssueType("damaged"));

// ── Source sweep ───────────────────────────────────────────────────────────
const read = (p: string) => fs.readFileSync(p, "utf8");

const action = read("src/app/admin/actions/reportDamagedItem.ts");
ok("action accepts the typed issue", action.includes("normalizeIssueType"));
ok("cleaner kit is always updated", action.includes("employeeProduct.update"));
ok("company write-off is conditional, not unconditional",
  action.includes("if (writeOff)"));
ok("a kit audit row is always written", action.includes("inventoryChange.create"));
// Stage 4 turned this from the array form of $transaction into the interactive
// form — `adjustWarehouseStock` reads the location rows before it writes, which
// no prepared promise can do. Still one transaction; the open-flag lookup moved
// inside it as a bonus.
ok("everything runs in one transaction",
  action.includes("db.$transaction(async (tx) => {"));
ok("the company write-off goes through the one warehouse writer",
  action.includes("adjustWarehouseStock(tx, {"));
ok("cleaner can only report against their OWN kit",
  action.includes("employeeId: actor.id"));
ok("over-reporting is rejected", action.includes("You only have"));
ok("alert severity differentiates restock from loss",
  action.includes('needsRestock(issue) ? "INFO" : "WARNING"'));

const ui = read("src/app/cleaners/my-inventory/MyInventoryClient.tsx");
ok("UI offers all four types from the shared list",
  ui.includes("INVENTORY_ISSUE_TYPES.map"));
ok("UI no longer hardcodes damaged/lost only",
  !ui.includes('setDamageKind("damaged")') && !ui.includes('setDamageKind("lost")'));
ok("UI lets the cleaner set a quantity", ui.includes("setDamageQty"));
ok("UI takes an optional note", ui.includes("setDamageReason"));
ok("UI explains the consequence per type",
  ui.includes("writesOffCompanyStock(damageKind)"));

// The activity labels moved out of the reader and into a pure module when
// Stage 3 replaced reason-string matching with a stored `InventoryAction`
// column. These rows are old enough to predate that column, so the derived
// reading is still what labels them — and still has to know the issue words.
const log = read("src/lib/inventory-action.ts");
ok("activity log labels the new issue types",
  log.includes('"Reported broken"') && log.includes('"Ran out"'));
ok("activity log still labels legacy 'damaged' rows",
  log.includes('"Reported damaged"'));
ok("...and the reader delegates to it rather than keeping its own copy",
  read("src/app/admin/actions/getInventoryActivity.ts").includes("activityActionLabel("));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
