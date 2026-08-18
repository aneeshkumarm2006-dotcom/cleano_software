// Verification for STAGE 4 of `_ai_context/TODO.md` —
// warehouse stock: one source of truth (cleano_inventory_operations_fixes.pdf #5).
//
// Run: npx tsx scripts/verify-warehouse-stock.ts
//      npx tsx scripts/verify-warehouse-stock.ts --db   (adds the live-data check)
//
// Two halves, matching the other verify-* scripts in this repo:
//
//   1. A SOURCE SWEEP — the structural guarantee. `Product.stockLevel` and the
//      per-location rows may only be written by `src/lib/stock.server.ts`. This
//      is the check that actually prevents the bug coming back: the 8-vs-0 pair
//      on p.5 of the PDF happened because six different files wrote these two
//      numbers and three of them wrote only one. A grep is crude, but it is the
//      only thing that fails when someone adds a seventh next month.
//
//   2. THE INVARIANT over real data — `stockLevel === SUM(location rows)` for
//      every product. Opt-in via `--db`, because Stage 1's migration is still
//      deferred and the default run has to hold on code alone (same rule the
//      Stage 2 and Stage 3 scripts follow).

import fs from "node:fs";

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

const section = (title: string) => console.log(`\n── ${title} ──`);

const walk = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) return walk(full);
        return /\.tsx?$/.test(e.name) ? [full] : [];
      })
    : [];

const HELPER = "src/lib/stock.server.ts";
const SRC_FILES = walk("src").map((f) => f.replace(/\\/g, "/"));

/* ═══════════════════ 4.1 · the helper is the only writer ══════════════════ */

section("4.1 · the helper");

ok("stock.server.ts exists", fs.existsSync(HELPER));
has("...exposing the delta writer", HELPER, "export async function adjustWarehouseStock");
has("...and the absolute-set writer", HELPER, "export async function setLocationQuantity");
has("...and the one-product reconciler both it and the script share", HELPER,
  "export async function reconcileProductStock");

// The three things every movement must do together. Doing any TWO of them is
// exactly the state the codebase was in before Stage 4.
hasCode("a movement writes the location row", HELPER, "inventoryLocationStock.upsert");
hasCode("...recomputes the cache from every location row", HELPER,
  "async function syncStockLevel");
hasCode("...from a real SUM, not an increment", HELPER, "_sum: { quantity: true }");
hasCode("...and writes the warehouse audit row", HELPER, "tx.inventoryChange.create");
hasCode("the audit row records what kind of movement it was", HELPER,
  "action: args.action");
hasCode("the warehouse row is never attributed to a cleaner", HELPER,
  "employeeId: null");

// Multi-location is the normal case (the seeds split stock 75/25), so a
// hand-out has to leave a shelf that actually has the stock.
has("hand-outs choose a source location", HELPER,
  "export async function pickSourceLocationId");
hasCode("...preferring one that can cover the whole amount", HELPER,
  "rows.find((r) => r.quantity >= quantity)");
hasCode("...only from ACTIVE locations", HELPER, "location: { isActive: true }");
hasCode("...and falling back to the default rather than blocking", HELPER,
  "return ensureDefaultLocationId(tx);");

// Reconciling is a representation fix, not a movement: it must not fabricate
// history to explain a bug.
ok(
  "reconcileProductStock writes no InventoryChange",
  !/reconcileProductStock[\s\S]*?\n}/.exec(codeOf(HELPER))?.[0].includes("inventoryChange")
);

/* ═════════════ 4.2 · nothing else may touch either warehouse store ════════ */

section("4.2 · no second writer");

// (a) `Product.stockLevel` writes. Reads are everywhere and are fine — the
//     cache exists to be read. What must be unique is who SETS it.
//
//     A write is `stockLevel:` appearing inside a Prisma product write call.
//     `stockLevel: true` in a select, `stockLevel: number` in an interface and
//     `stockLevel: p.stockLevel` in a view's projection are all reads.
function stockLevelWrites(code: string): string[] {
  const values: string[] = [];
  const re = /stockLevel:\s*([^,\n}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const value = m[1].trim().replace(/;$/, "");
    if (value === "true" || value === "number" || value === "string") continue;
    // Was this inside a `…product.update/create/upsert(` payload?
    const before = code.slice(Math.max(0, m.index - 400), m.index);
    if (/\bproduct\.(update|updateMany|upsert|create|createMany)\(/.test(before)) {
      values.push(value);
    }
  }
  return values;
}
{
  // createProduct/importCsv pin the column to 0 at creation and let the helper
  // fill it in. That literal is allowed precisely because it is the ABSENCE of
  // a competing number rather than a second source of one.
  const allowed = new Set([
    "src/app/admin/actions/createProduct.ts",
    "src/app/admin/actions/importCsv.ts",
  ]);
  const offenders = SRC_FILES.filter(
    (f) => f !== HELPER && !allowed.has(f) && stockLevelWrites(codeOf(f)).length > 0
  );
  check("no file outside stock.server.ts writes Product.stockLevel", offenders, []);

  for (const f of allowed) {
    check(
      `${f.split("/").pop()} only ever pins it to 0 at creation`,
      stockLevelWrites(codeOf(f)),
      ["0"]
    );
  }
  // …and the helper does write it, or the invariant would be maintained by
  // nobody at all.
  ok("stock.server.ts does write it", stockLevelWrites(codeOf(HELPER)).length > 0);
}

// (b) location-row writes.
{
  const offenders = SRC_FILES.filter(
    (f) =>
      f !== HELPER &&
      /inventoryLocationStock\.(upsert|update|updateMany|create|createMany|delete|deleteMany)\(/.test(
        codeOf(f)
      )
  );
  check("no file outside stock.server.ts writes a location row", offenders, []);
}

// (c) the pre-Stage-4 helper is gone, not merely unused. It only ever touched
//     the OLDEST active location while the seeds create two, so it drifted by
//     construction.
ok("syncDefaultLocationStock is deleted", !fs.existsSync("src/lib/inventory.ts"));
{
  const stragglers = SRC_FILES.filter((f) =>
    codeOf(f).includes("syncDefaultLocationStock")
  );
  check("...and nothing still imports it", stragglers, []);
}

// (d) every writer named in the Stage 4 table now routes through the helper —
//     including the three that used to move only one of the two stores.
const ROUTED: Array<[string, string]> = [
  ["src/app/admin/actions/setLocationStock.ts", "setLocationQuantity(tx, {"],
  ["src/app/admin/actions/resolveInventoryRequest.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/assignKit.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/reportDamagedItem.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/checkoutInventory.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/bulkAssignCleanerInventory.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/createProduct.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/updateProduct.ts", "adjustWarehouseStock(tx, {"],
  ["src/app/admin/actions/importCsv.ts", "adjustWarehouseStock(tx, {"],
  // Stage 5's "Return removed units to warehouse" — the tenth writer, and the
  // first one added after this rule existed. It is here to prove the rule held.
  ["src/app/admin/actions/setCleanerProductQuantity.ts", "adjustWarehouseStock(tx, {"],
];
for (const [path, needle] of ROUTED) {
  has(`${path.split("/").pop()} moves stock through the helper`, path, needle);
}

// The helper takes a transaction client, so every caller must be inside an
// interactive transaction — a stock move that isn't atomic with the kit move
// it accompanies is the drift, in miniature.
for (const [path] of ROUTED) {
  ok(
    `...${path.split("/").pop()} does it inside a transaction`,
    /\$transaction\(\s*async \(tx\)/.test(codeOf(path))
  );
}

// checkoutInventory used to decrement BOTH stores by hand. The risk when
// routing it through the helper was double-counting; assert the hand-written
// product decrement is gone.
{
  const co = codeOf("src/app/admin/actions/checkoutInventory.ts");
  ok(
    "checkoutInventory no longer decrements the product itself",
    !/product\.update\([\s\S]{0,200}stockLevel/.test(co)
  );
}
{
  const bulk = codeOf("src/app/admin/actions/bulkAssignCleanerInventory.ts");
  ok(
    "bulkAssign no longer decrements the product itself",
    !/product\.update\([\s\S]{0,200}stockLevel/.test(bulk)
  );
  ok(
    "...and company stock still moves ONLY in FROM_LOCKER mode",
    /if \(mode === "FROM_LOCKER"\) \{[\s\S]*?adjustWarehouseStock/.test(bulk)
  );
}

/* ═══════════════════ 4.4 · the approval gate is honest ═══════════════════ */

section("4.4 · approval gate");

const RESOLVE = "src/app/admin/actions/resolveInventoryRequest.ts";
hasCode("approval still blocks a genuinely short warehouse", RESOLVE,
  "request.product.stockLevel < request.quantity");
has("...and the error states the real number", RESOLVE,
  "Only ${request.product.stockLevel}");
has("...and what the request actually needs", RESOLVE,
  "needs ${request.quantity}");
// The number in that message and the number the Requests tab warns with are the
// same column, and it is now maintained. That is what makes "8 in the modal,
// 0 in the requests list" impossible rather than merely unlikely.
has("the Requests tab warns from the same column", "src/app/admin/inventory/page.tsx",
  "warehouseStock: r.product?.stockLevel ?? null");
has("...and renders it", "src/app/admin/inventory/RequestsView.tsx",
  "Only {req.warehouseStock}");
// Approving must take the units off a real shelf, not always the default one.
has("approval sources the stock from a location", RESOLVE, "pickSourceLocationId(");

/* ══════════════════ 4.5 · no stale snapshots between tabs ════════════════ */

section("4.5 · fresh numbers everywhere");

const MODAL = "src/app/admin/inventory/ProductModal.tsx";
ok("the product modal no longer hard-reloads the page",
  !codeOf(MODAL).includes("window.location.reload()"));
has("...it refreshes the server render instead", MODAL, "router.refresh()");
has("the requests tab refreshes too", "src/app/admin/inventory/RequestsView.tsx",
  "router.refresh()");
has("quick assign refreshes too", "src/app/admin/inventory/QuickAssignModal.tsx",
  "router.refresh()");
has("Manage Stock refreshes too", "src/app/admin/settings/tabs/InventoryLocationsTab.tsx",
  "router.refresh()");

// A refresh only helps if the hub re-reads rather than replaying first-render
// state, and if the server render was invalidated.
hasCode("the hub renders the server's products, not a frozen copy",
  "src/app/admin/inventory/InventoryPageClient.tsx", "products={initialProducts}");
hasCode("...and the server's requests", "src/app/admin/inventory/InventoryPageClient.tsx",
  "<RequestsView requests={requests} />");
{
  const MUTATIONS = [
    "src/app/admin/actions/updateProduct.ts",
    "src/app/admin/actions/createProduct.ts",
    "src/app/admin/actions/resolveInventoryRequest.ts",
    "src/app/admin/actions/setLocationStock.ts",
    "src/app/admin/actions/bulkAssignCleanerInventory.ts",
    "src/app/admin/actions/setCleanerProductQuantity.ts",
  ];
  for (const m of MUTATIONS) {
    has(`${m.split("/").pop()} revalidates the inventory hub`, m,
      'revalidatePath("/admin/inventory")');
  }
  // Manage Stock lives on Settings and reads the same location rows, so a
  // stock move anywhere has to invalidate it too.
  for (const m of MUTATIONS) {
    has(`${m.split("/").pop()} revalidates Manage Stock`, m,
      'revalidatePath("/admin/settings")');
  }
}

/* ═══════════ 4.7 · cleaner counts raise flags, not auto-requests ═════════ */

section("4.7 · the Requests-tab flood");

// The 48 pending rows in images/page-05-img-1.png were auto-created with the
// reason "Inventory count submitted by cleaner". Stage 3 replaced that flow
// with `InventoryFlag`. Assert the auto-creator is retired rather than merely
// quiet, and that the paths that could re-create it don't.
{
  const stragglers = SRC_FILES.filter((f) =>
    /Inventory count submitted/i.test(read(f))
  );
  check("nothing auto-files a request from a cleaner count", stragglers, []);
}
for (const f of [
  "src/app/admin/actions/updateMyInventoryCount.ts",
  "src/app/admin/actions/updateMyItemCondition.ts",
  "src/app/admin/actions/clockOut.ts",
]) {
  ok(
    `${f.split("/").pop()} files no InventoryRequest`,
    !/inventoryRequest\.create/.test(codeOf(f))
  );
}
// Requests are now only ever raised deliberately: by the cleaner asking, or by
// an admin turning a flag into a restock.
{
  const creators = SRC_FILES.filter((f) =>
    /inventoryRequest\.create\(/.test(codeOf(f))
  ).sort();
  check("only the deliberate paths file a request", creators, [
    "src/app/admin/actions/createInventoryRequest.ts",
    "src/app/admin/actions/importCsv.ts",
    "src/app/admin/actions/requestRefill.ts",
    "src/app/admin/actions/resolveInventoryFlag.ts",
  ]);
}
has("...and clock-out raises a flag instead", "src/app/admin/actions/clockOut.ts",
  "inventoryFlag.create");

/* ═════════════ the invariant, over real data (opt-in with --db) ══════════ */

async function checkInvariant() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const products = await db.product.findMany({
      select: { id: true, name: true, stockLevel: true },
    });
    const rows = await db.inventoryLocationStock.findMany({
      select: { productId: true, quantity: true },
    });
    const sum = new Map<string, number>();
    for (const r of rows) {
      sum.set(r.productId, (sum.get(r.productId) ?? 0) + r.quantity);
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const bad = products
      .filter((p) => {
        const s = round2(sum.get(p.id) ?? 0);
        const c = round2(p.stockLevel);
        // A product with no location rows and no stock is consistent.
        return !(s === 0 && c === 0) && s !== c;
      })
      .map((p) => `${p.name}: stockLevel=${p.stockLevel}, locations=${sum.get(p.id) ?? 0}`);
    check("stockLevel === SUM(location rows) for every product", bad, []);
    if (bad.length > 0) {
      console.log("        run: npx tsx scripts/reconcileWarehouseStock.ts --dry-run");
    }
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  if (process.argv.includes("--db")) {
    section("the invariant, against the live database");
    await checkInvariant();
  } else {
    section("the invariant, against the live database");
    console.log(
      "SKIP  stockLevel === SUM(location rows) — pass --db to run it " +
        "(Stage 1's migration is still deferred, so the default run stays code-only)."
    );
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
