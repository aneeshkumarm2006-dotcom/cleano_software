// Verification for STAGE 5 of `_ai_context/TODO.md` — cleaner inventory
// editing: fix "Product not found" + explicit warehouse return
// (cleano_inventory_operations_fixes.pdf #6, p.6).
//
// Run: npx tsx scripts/verify-stage5-kit-editing.ts
//      npx tsx scripts/verify-stage5-kit-editing.ts --db   (adds the live-data report)
//
// Three halves, matching the other verify-* scripts in this repo:
//
//   1. THE PURE RULE — `unitsRemovedFromKit`, exercised directly. It decides
//      whether the return checkbox appears, what it promises, and what the
//      server puts back; all three read the same function, so it is worth
//      pinning on its own.
//
//   2. A SOURCE SWEEP — the structural guarantees. Which lookup each kit-facing
//      action uses, which pickers exclude archived products, and that the
//      warehouse only ever moves through the Stage 4 helper. A grep is crude,
//      but it is the only thing that fails when someone adds a sixth action
//      next month and guesses its `where` clause like the first five did.
//
//   3. THE ORPHANS, over real data (opt-in via `--db`) — kit rows whose product
//      has been archived. These are the rows that produced the p.6 screenshot.
//      Finding some is EXPECTED and fine after this stage: the point is that
//      they are now editable, not that they don't exist.

import fs from "node:fs";
import { unitsRemovedFromKit } from "../src/lib/kit-edit";

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
/** A file with its comment lines stripped — a rule may be quoted in prose. */
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
const lacksCode = (name: string, path: string, needle: string) =>
  ok(name, !codeOf(path).includes(needle));

const section = (title: string) => console.log(`\n── ${title} ──`);

const LOOKUP = "src/lib/kit-product.server.ts";
const SET_QTY = "src/app/admin/actions/setCleanerProductQuantity.ts";
const KIT_ACTIONS = "src/app/admin/actions/assignToCleanerKit.ts";
const CLEANER_VIEW = "src/app/admin/inventory/CleanerInventoryView.tsx";
const EMPLOYEE_VIEW = "src/app/admin/employees/[id]/EmployeeDetailView.tsx";

/* ══════════════════ the pure rule: what a kit edit removes ═══════════════ */

section("5.4 · unitsRemovedFromKit (pure)");

// An EMPTY box is not a removal — it is an unfinished edit. Getting this wrong
// is how a cleared field silently deletes a kit row.
check("empty input removes nothing", unitsRemovedFromKit("", 2), 0);
check("a whitespace input removes nothing", unitsRemovedFromKit("   ", 2), 0);
check("nonsense removes nothing", unitsRemovedFromKit("abc", 2), 0);
check("a negative removes nothing", unitsRemovedFromKit("-1", 2), 0);
// The real cases.
check("2 → 0 removes 2", unitsRemovedFromKit("0", 2), 2);
check("5 → 3 removes 2", unitsRemovedFromKit("3", 5), 2);
check("2 → 1.5 removes 0.5", unitsRemovedFromKit("1.5", 2), 0.5);
check("an unchanged count removes nothing", unitsRemovedFromKit("2", 2), 0);
check("an INCREASE removes nothing", unitsRemovedFromKit("7", 2), 0);
check("numbers work as well as strings", unitsRemovedFromKit(0, 2), 2);
// Float noise must not reach an audit row.
check("rounded to 2dp", unitsRemovedFromKit(0.1, 0.3), 0.2);

/* ═══════════════ 5.1 · the kit row is the target, not the catalogue ══════ */

section("5.1 · the lookup that caused the bug");

ok("setCleanerProductQuantity exists", fs.existsSync(SET_QTY));

// THE regression. The p.6 error came from resolving the product through the
// live catalogue with `deletedAt: null`, so an archived product a cleaner still
// held could be rendered but never edited.
//
// Counted rather than grepped for absence: the action legitimately keeps ONE
// `deletedAt` FILTER — on the USER, to stop a kit row being pointed at an
// archived account. A second `deletedAt: null` means the product is being
// filtered again, which is the bug.
check(
  "...only ONE deletedAt filter remains, and it guards the cleaner",
  (codeOf(SET_QTY).match(/deletedAt: null/g) ?? []).length,
  1
);
// The product's archived flag is READ, not filtered on — the row can be edited
// either way, and the caller gets to see which it is.
hasCode("...the kit row's product is read WITH its archived flag", SET_QTY,
  "deletedAt: true");
ok(
  "...resolves the target through the EmployeeProduct row",
  /employeeProduct\.findUnique\(\{[\s\S]{0,200}employeeId_productId/.test(
    codeOf(SET_QTY)
  )
);
ok(
  "...and never asks the catalogue whether an EXISTING row's product is archived",
  !/product\.find(First|Unique)\(/.test(codeOf(SET_QTY))
);
// The error the PDF is named after must be gone from this file entirely.
lacksCode('..."Product not found." is gone from the action', SET_QTY, "Product not found.");
has("...replaced by a message about the ASSIGNMENT", SET_QTY, "KIT_ROW_MISSING");
has(
  "...whose wording blames the kit row, not the product",
  LOOKUP,
  "This item is no longer in the cleaner's inventory."
);
// A row that does not exist yet is a NEW assignment, so the catalogue rules
// apply there and only there.
has("creating a new row still goes through the assignable lookup", SET_QTY,
  "findAssignableProduct(productId)");

/* ═════════════════ 5.2 · one shared rule for five actions ════════════════ */

section("5.2 · the shared lookup");

ok("kit-product.server.ts exists", fs.existsSync(LOOKUP));
has("...exposes the edit/remove lookup", LOOKUP, "export async function findKitProduct");
has("...and the assign/request lookup", LOOKUP, "export async function findAssignableProduct");
has("...and the picker `where` clause", LOOKUP, "export const ASSIGNABLE_PRODUCT_WHERE");

// The whole distinction in two assertions: one lookup must NOT filter, the
// other must refuse.
{
  const editFn =
    /export async function findKitProduct[\s\S]*?\n}/.exec(codeOf(LOOKUP))?.[0] ?? "";
  ok("findKitProduct does not filter archived rows out", !editFn.includes("deletedAt"));
  ok("...and selects deletedAt so callers can see it", codeOf(LOOKUP).includes("deletedAt: true"));
}
{
  const assignFn =
    /export async function findAssignableProduct[\s\S]*?\n}/.exec(codeOf(LOOKUP))?.[0] ?? "";
  ok("findAssignableProduct refuses an archived product", assignFn.includes("product.deletedAt"));
  ok("...naming it, and the way back", assignFn.includes("archivedProductError(product.name)"));
}
has("...the message says where to restore it from", LOOKUP, "Inventory → Archived");

// All five sibling actions now share it, instead of each guessing.
const ASSIGNERS = [
  SET_QTY,
  KIT_ACTIONS,
  "src/app/admin/actions/createInventoryRequest.ts",
  "src/app/admin/actions/requestRefill.ts",
  "src/app/cleaners/my-inventory/addMyInventoryItem.ts",
];
for (const f of ASSIGNERS) {
  has(`${f.split("/").pop()} uses the shared lookup`, f, "findAssignableProduct");
}
// …and none of them still hand-rolls the error that started all this.
for (const f of ASSIGNERS) {
  ok(
    `...${f.split("/").pop()} no longer hard-codes "Product not found"`,
    !/error:\s*["'`]Product not found/.test(codeOf(f))
  );
}

// The counterpart rule: a REMOVAL resolves through the kit row and must keep
// working for an archived product. This action already had the right shape and
// is the model the others were aligned to.
{
  const removeFn =
    /export async function removeFromCleanerKit[\s\S]*$/.exec(codeOf(KIT_ACTIONS))?.[0] ?? "";
  ok(
    "removeFromCleanerKit resolves through the kit row",
    removeFn.includes("employeeProduct.findUnique")
  );
  ok(
    "...and never checks the catalogue for archived",
    !removeFn.includes("findAssignableProduct")
  );
}

/* ═══════════════════ 5.3 · archived products stop spreading ══════════════ */

section("5.3 · no new orphans");

// Every picker that offers a product TO ASSIGN. The kits page had no filter at
// all, which is the easiest possible way to put a soft-deleted product into a
// kit and orphan the row.
const PICKERS: Array<[string, string]> = [
  ["src/app/admin/inventory/kits/page.tsx", "ASSIGNABLE_PRODUCT_WHERE"],
  ["src/app/admin/inventory/page.tsx", "ASSIGNABLE_PRODUCT_WHERE"],
  ["src/app/admin/actions/checkEquipmentForJob.ts", "ASSIGNABLE_PRODUCT_WHERE"],
  ["src/app/cleaners/my-inventory/page.tsx", "deletedAt: null"],
  ["src/app/admin/actions/getLocationProducts.ts", "deletedAt: null"],
  ["src/app/admin/actions/bulkAssignCleanerInventory.ts", "deletedAt: null"],
  ["src/app/admin/actions/checkoutInventory.ts", "deletedAt: null"],
];
for (const [path, needle] of PICKERS) {
  has(`${path.split("/").pop()} offers active products only`, path, needle);
}
// Quick Assign is fed from the inventory hub, and the hub can be rendering the
// ARCHIVED tab — where `productsWithStats` is archived-only. The assign list
// has to be built separately there or the picker offers nothing BUT archived.
hasCode("...Quick Assign stays active-only on the Archived tab",
  "src/app/admin/inventory/page.tsx", "const assignableRows = archived");

// Kit templates are assigned wholesale, so an archived line in one is the same
// orphan by another route — and this is the route the live orphans came down.
// Archived lines are SKIPPED (the live "Default Starting Kit" has nine of them;
// refusing the kit outright would have killed the flow) and reported by name.
{
  const ak = codeOf("src/app/admin/actions/assignKit.ts");
  ok("issuing a kit template skips archived lines",
    ak.includes("it.product.deletedAt === null"));
  ok("...and issues only those", /for \(const item of issuable\)/.test(ak));
  ok("...stock is checked against the issuable lines only",
    ak.includes("issuable.filter("));
  ok("...the skipped names come back to the caller",
    /return \{ success: true, skipped \}/.test(ak));
  ok("...and an all-archived kit is an honest error, not a silent no-op",
    ak.includes("issuable.length === 0"));
}
has("the UI names what it did not issue", EMPLOYEE_VIEW,
  "Kit assigned, minus ${skipped.length} archived product");
ok("...and does not auto-close over that message",
  /if \(skipped\.length > 0\) \{\s*router\.refresh\(\);/.test(codeOf(EMPLOYEE_VIEW)));

// Hard delete still refuses a product anyone holds (this guard predates
// Stage 5 and must not have been loosened while fixing the soft-delete side).
hasCode("hard delete still blocks an assigned product",
  "src/app/admin/actions/deleteProduct.ts", "product.employeeProducts.length > 0");

// Soft delete (the bulk "Delete" action) is what actually created the p.6
// orphan, and it has no server-side guard by design — archiving a product being
// phased out is legitimate. What it must not be is SILENT.
has("bulk archive warns when the selection is still in kits",
  "src/app/admin/inventory/InventoryView.tsx", "still in cleaner kits");
hasCode("...counted from the rows already on screen",
  "src/app/admin/inventory/InventoryView.tsx", "p.employeeCount > 0");
has("...and says the kit items survive it",
  "src/app/admin/inventory/InventoryView.tsx", "can still be counted and removed");

/* ═════════════ 5.4 · warehouse stock only moves when asked ═══════════════ */

section("5.4 · the explicit return");

// Default OFF, and only ever true when the client asked in so many words.
hasCode("the return is opt-in", SET_QTY, "input?.returnToWarehouse === true");
hasCode("...and only for units actually removed", SET_QTY,
  "if (wantsReturn && removed > 0)");
// Through the Stage 4 helper, so the location row, the cache and the audit row
// move together — never by writing stockLevel here.
has("...moving stock through the Stage 4 helper", SET_QTY, "adjustWarehouseStock(tx, {");
ok(
  "...inside the same transaction as the kit write",
  /\$transaction\(\s*async \(tx\)/.test(codeOf(SET_QTY))
);
ok(
  "...and never writing Product.stockLevel itself",
  !/product\.update\([\s\S]{0,200}stockLevel/.test(codeOf(SET_QTY))
);
hasCode("...recording which shelf they went back on", SET_QTY, "ensureDefaultLocationId(tx)");
has("...in the audit reason", SET_QTY, "Returned from ${cleaner.name");
// An INCREASE must never quietly withdraw stock: that is an assignment, and it
// belongs to the flow that records which location it left.
has("the kit-side row says the units were returned", SET_QTY,
  "returned to ${returnedInfo.locationName}");
// Settings → Manage Stock reads the location rows a return moves.
has("...and Manage Stock is revalidated", SET_QTY, 'revalidatePath("/admin/settings")');

// Both editors: the checkbox exists, starts OFF, and is only offered when the
// count is going down.
for (const view of [CLEANER_VIEW, EMPLOYEE_VIEW]) {
  const name = view.split("/").pop();
  hasCode(`${name} has the return checkbox`, view, "returnToWarehouse");
  // Pinned to THIS state, not to any `useState(false)` in the file — both views
  // have several, so a loose match would pass whatever the default became.
  ok(
    `...${name} defaults it OFF`,
    /const \[returnToWarehouse, setReturnToWarehouse\] = useState\(false\)/.test(
      codeOf(view)
    )
  );
  ok(
    `...${name} re-arms it OFF when the editor opens`,
    /setReturnToWarehouse\(false\)/.test(codeOf(view))
  );
  hasCode(`...${name} only offers it on a decrease`, view, "unitsRemovedFromKit");
  has(`...${name} still promises nothing moves otherwise`, view,
    "Warehouse stock is not affected.");
}

/* ═════════════════════ 5.5 · what the history records ════════════════════ */

section("5.5 · history completeness");

// The PDF's list: change, admin name, cleaner name, item, old count, new count,
// reason, timestamp. Scoped to the kit-side `inventoryChange.create` payload —
// several of these tokens appear elsewhere in the file, so a whole-file grep
// would pass on the wrong statement.
{
  const auditRow =
    /tx\.inventoryChange\.create\(\{[\s\S]*?\n      \}\);/.exec(codeOf(SET_QTY))?.[0] ?? "";
  ok("the kit-side audit row is written", auditRow.length > 0);
  for (const field of [
    "productId: product.id",
    "employeeId: cleaner.id",
    "employeeName: cleaner.name",
    "quantityChange: newQuantity - previous",
    "newQuantity,",
    "unit: product.unit",
    'action: "ADMIN_SET"',
    "changedById: actor?.id",
    "changedByName: actor?.name",
  ]) {
    ok(`...it carries ${field.split(":")[0].trim()}`, auditRow.includes(field));
  }
  // `createdAt` is the column default — asserted here so the PDF's "timestamp"
  // bullet is accounted for rather than assumed.
  ok(
    "...and takes its timestamp from the column default",
    !auditRow.includes("createdAt")
  );
}
// The admin's own words survive; the hardcoded sentence is only the fallback.
hasCode("the UI's reason is passed through", SET_QTY, 'reason ?? "Count set by admin"');
// Both editors actually collect one.
for (const view of [CLEANER_VIEW, EMPLOYEE_VIEW]) {
  has(`${view.split("/").pop()} collects a reason`, view, "Reason (optional)");
}
// OLD count as well as new, on the activity log — the product detail page has
// shown the transition for a while; this is the surface that only showed "now".
has("the activity log shows old → new", "src/app/admin/inventory/ActivityView.tsx",
  "{e.newQuantity - e.quantityChange} → {e.newQuantity}");
has("...as does the product's stock history",
  "src/app/admin/inventory/[id]/ProductDetailView.tsx",
  "{c.newQuantity - c.quantityChange} → {c.newQuantity}");

/* ══════════════════════ 5.6 · the edit lands immediately ═════════════════ */

section("5.6 · immediate update, recoverable errors");

for (const view of [CLEANER_VIEW, EMPLOYEE_VIEW]) {
  const name = view.split("/").pop();
  hasCode(`${name} refreshes the server render on success`, view, "router.refresh()");
  hasCode(`...${name} clears the error before each attempt`, view, "setError(null)");
  // An empty box is not zero, and zero DELETES the row — the one edit here that
  // another number can't undo.
  hasCode(`...${name} refuses an empty quantity`, view, 'qty.trim() === ""');
  has(`...${name} says how to remove instead`, view, "type 0 to remove the item");
}
// The "N units returned to X" confirmation has to outlive the thing that
// triggers it. On the employee page a successful return either unmounts the row
// (set to 0) or remounts the whole tab (`router.refresh()`), so the message is
// held on the PAGE and the row only reports it.
ok(
  "the employee page holds the return notice, not the row",
  /const \[kitNotice, setKitNotice\] = useState/.test(codeOf(EMPLOYEE_VIEW))
);
hasCode("...the row reports upward", EMPLOYEE_VIEW, "onNotice(");
hasCode("...and the page renders it", EMPLOYEE_VIEW, "{kitNotice && (");
// The Cleaner Inventory tab keeps its notice on the view component, which
// `router.refresh()` re-renders rather than remounts.
ok(
  "the cleaner-inventory tab holds its notice on the view",
  /const \[notice, setNotice\] = useState/.test(codeOf(CLEANER_VIEW))
);

// The employee page carried the EmployeeProduct id as `id` right beside
// `productId`, one refactor-swap from re-creating this exact bug.
lacksCode("the employee DTO no longer calls the row id `id`",
  "src/app/admin/employees/[id]/page.tsx", "id: p.id,\n    productId: p.product.id");
has("...it is named for what it is", "src/app/admin/employees/[id]/page.tsx",
  "employeeProductId: p.id");

/* ═══════════ the orphans, over real data (opt-in with --db) ══════════════ */

async function reportOrphans() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const rows = await db.employeeProduct.findMany({
      where: { product: { deletedAt: { not: null } } },
      select: {
        quantity: true,
        employee: { select: { name: true } },
        product: { select: { name: true, unit: true, deletedAt: true } },
      },
      orderBy: { quantity: "desc" },
    });

    if (rows.length === 0) {
      console.log("INFO  no kit rows point at an archived product today.");
    } else {
      console.log(
        `INFO  ${rows.length} kit row${rows.length === 1 ? "" : "s"} point at an ARCHIVED product.`
      );
      console.log(
        "      These are the rows that used to fail with \"Product not found.\"."
      );
      console.log(
        "      They are expected and are not an error: after Stage 5 they can be"
      );
      console.log(
        "      counted and removed normally, and the product cannot be assigned anew."
      );
      for (const r of rows.slice(0, 25)) {
        console.log(
          `      • ${r.employee?.name ?? "Unknown"} — ${r.product?.name} × ${r.quantity} ${r.product?.unit ?? ""}`
        );
      }
      if (rows.length > 25) console.log(`      … and ${rows.length - 25} more`);
    }

    // Kit-template hygiene. Not a failure — `assignKit` skips these lines and
    // names them, so nothing breaks — but a template quietly issuing less than
    // it lists is worth an admin's attention, and this is the only place that
    // says so before someone notices a cleaner is short.
    const templates = await db.kitTemplate.findMany({
      where: { isActive: true, items: { some: { product: { deletedAt: { not: null } } } } },
      select: {
        name: true,
        items: {
          where: { product: { deletedAt: { not: null } } },
          select: { product: { select: { name: true } } },
        },
      },
    });
    if (templates.length === 0) {
      console.log("INFO  no active kit template lists an archived product.");
    } else {
      console.log(
        `INFO  ${templates.length} active kit template${
          templates.length === 1 ? " lists" : "s list"
        } archived products, which are now SKIPPED when issued:`
      );
      for (const t of templates) {
        console.log(
          `      • ${t.name} — ${t.items.map((i) => i.product.name).join(", ")}`
        );
      }
      console.log(
        "      Fix in Settings → Kit Templates: remove the line, or restore the product."
      );
    }
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  section("orphaned kit rows, against the live database");
  if (process.argv.includes("--db")) {
    await reportOrphans();
  } else {
    console.log(
      "SKIP  archived-product kit rows — pass --db to list them " +
        "(the default run stays code-only, matching the Stage 2–4 scripts)."
    );
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
