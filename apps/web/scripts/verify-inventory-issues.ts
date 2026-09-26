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
} from "@bookmops/core/inventory";

import { custodyLeft, splitWriteOff } from "../src/server/kit/custody";

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

// The rules moved into server/kit/issue.ts, shared by the web action (now an
// adapter) and the phone's POST /api/v1/kit/items/:id/issues.
const action = read("src/app/admin/actions/reportDamagedItem.ts");
const service = read("src/server/kit/issue.ts");
ok("action accepts the typed issue", action.includes("normalizeIssueType"));
ok("...and hands it to the shared service", action.includes("reportKitIssue("));
ok("cleaner kit is always updated, by a conditional decrement",
  service.includes("employeeProduct.updateMany") && service.includes("quantity: { gte: qty }") &&
    service.includes("quantity: { decrement: qty }"));
ok("company write-off is conditional, not unconditional",
  service.includes("if (writeOff)") && service.includes("if (split.fromStock > 0)"));
ok("a kit audit row is always written", service.includes("inventoryChange.create"));
// Stage 4 turned this from the array form of $transaction into the interactive
// form — `adjustWarehouseStock` reads the location rows before it writes, which
// no prepared promise can do. Still one transaction; the open-flag lookup moved
// inside it as a bonus.
ok("everything runs in one transaction",
  service.includes("db.$transaction(async (tx) => {"));
ok("the company write-off goes through the one warehouse writer",
  service.includes("adjustWarehouseStock(tx, {"));
ok("cleaner can only report against their OWN kit",
  service.includes("employeeId: actor.userId") && !service.includes("employeeId: input."));
ok("over-reporting is rejected", service.includes("You only have") && service.includes('"NOT_ENOUGH_IN_KIT"'));
ok("alert severity differentiates restock from loss",
  service.includes('needsRestock(issue) && split.excess === 0 ? "INFO" : "WARNING"'));
ok("the write-off is capped at custody, read inside the transaction",
  service.includes("splitWriteOff(qty, await custodyOf(tx,"));
ok("...recording what came off pickup stock", service.includes("issuedWriteOff: writeOff ? split.fromIssued : null"));

// ── The custody cap (pure) ─────────────────────────────────────────────────
{
  const none = { issuedInPlace: 0, issuedOffStock: 0, stockWrittenOff: 0, issuedWrittenOff: 0 };
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  ok("nothing issued: a write-off is all excess, nothing leaves stock",
    eq(splitWriteOff(3, custodyLeft(none)), { fromStock: 0, fromIssued: 0, excess: 3 }));
  ok("assigned stock is written off the warehouse",
    eq(splitWriteOff(2, custodyLeft({ ...none, issuedInPlace: 5 })), { fromStock: 2, fromIssued: 0, excess: 0 }));
  ok("picked-up stock is never taken off a location twice",
    eq(splitWriteOff(4, custodyLeft({ ...none, issuedOffStock: 5 })), { fromStock: 0, fromIssued: 4, excess: 0 }));
  ok("assigned first, then picked up, then excess",
    eq(splitWriteOff(10, custodyLeft({ ...none, issuedInPlace: 3, issuedOffStock: 4 })), { fromStock: 3, fromIssued: 4, excess: 3 }));
  ok("past write-offs use custody up",
    eq(custodyLeft({ issuedInPlace: 3, issuedOffStock: 4, stockWrittenOff: 3, issuedWrittenOff: 1 }), { inPlace: 0, offStock: 3 }));
  ok("a legacy over-deduction comes out of what is left",
    eq(custodyLeft({ issuedInPlace: 1, issuedOffStock: 4, stockWrittenOff: 3, issuedWrittenOff: 0 }), { inPlace: 0, offStock: 2 }));
  ok("never negative", eq(custodyLeft({ ...none, stockWrittenOff: 9 }), { inPlace: 0, offStock: 0 }));
}

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
const log = read("../../packages/core/src/inventory/inventory-action.ts");
ok("activity log labels the new issue types",
  log.includes('"Reported broken"') && log.includes('"Ran out"'));
ok("activity log still labels legacy 'damaged' rows",
  log.includes('"Reported damaged"'));
ok("...and the reader delegates to it rather than keeping its own copy",
  read("src/app/admin/actions/getInventoryActivity.ts").includes("activityActionLabel("));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
