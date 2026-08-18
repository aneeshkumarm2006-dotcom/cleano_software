import type { InventoryAction, Prisma } from "@prisma/client";

/**
 * WAREHOUSE STOCK — the only module allowed to move it (Stage 4, PDF #5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE (decision D5)
 *
 *   `InventoryLocationStock.quantity` rows are THE TRUTH.
 *   `Product.stockLevel` is a CACHE, maintained to equal SUM(location rows).
 *
 * Both numbers are always written together, inside the caller's transaction, by
 * one of the two functions below. Nothing else in the codebase may write
 * `stockLevel` or a location row — `scripts/verify-warehouse-stock.ts` greps for
 * violations and fails the build convention if one appears.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Before Stage 4 there were two independent stores and six writers, three of
 * which touched only one of them:
 *
 *   Manage Stock          → location row only  → the Requests tab said "0"
 *   Approve a refill      → stockLevel only    → the locker said "8"
 *   Assign a kit / report → stockLevel only      a cleaner sees a third number
 *   a damaged item
 *
 * That is the 8-vs-0 screenshot pair on p.5 of the PDF: the Edit Product modal
 * showing 8 Buckets while every pending request warned "Only 0 Buckets in
 * warehouse" and refused to be approved. Neither number was derived from the
 * other, and nothing anywhere computed SUM(locations), so they simply drifted.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NEGATIVE STOCK IS ALLOWED, DELIBERATELY
 *
 * Supplies get handed out and restocked outside the app, so a locker count is
 * an estimate. The repo's settled position (fix-list item 5, and the reason
 * `checkoutInventory` upserts rather than blocks) is that a short count warns
 * and reconciles later rather than stranding a cleaner mid-job. These helpers
 * keep that: a location row may go negative, and the admin inventory view
 * already surfaces negative rows for reconciliation.
 */

/**
 * Anything that can run a query — the interactive-transaction client, or the
 * plain `db` for reads outside a transaction. Writes must always pass a `tx`.
 */
export type StockClient = Prisma.TransactionClient;

interface StockActor {
  id?: string | null;
  name?: string | null;
}

interface AuditArgs {
  /** What this movement was. Drives the activity log's verb (Stage 3.1). */
  action: InventoryAction;
  /** Free text shown beside the verb. */
  reason?: string | null;
  /** Who did it. Absent for system/import paths. */
  actor?: StockActor | null;
  /**
   * The product's unit, when the caller already has it. Saves a read; the
   * helper looks it up when omitted.
   */
  unit?: string | null;
}

export interface StockResult {
  /** The location the movement was applied to. */
  locationId: string;
  /** That location's quantity afterwards (may be negative — see the note above). */
  locationQuantity: number;
  /** `Product.stockLevel` afterwards === SUM of every location row. */
  stockLevel: number;
  /** How much moved. `0` means the call was a no-op and wrote no audit row. */
  delta: number;
}

/** Float columns: keep sums off 7.999999999 territory. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The default inventory location — the oldest active one, created on first use.
 *
 * Stock edits that don't name a location land here. Seeds create two locations,
 * so "default" genuinely means "the one we picked", not "the only one".
 */
export async function ensureDefaultLocationId(tx: StockClient): Promise<string> {
  const existing = await tx.inventoryLocation.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.inventoryLocation.create({
    data: { name: "Main Storage" },
    select: { id: true },
  });
  return created.id;
}

/**
 * The true warehouse total for a product: SUM over every location row.
 *
 * `Product.stockLevel` should equal this at all times. Read this when you need
 * the answer to be right even if the cache has drifted — the reconciliation
 * script and the verify script both do. Ordinary screens read `stockLevel`,
 * which is the point of maintaining it.
 */
export async function getWarehouseTotal(
  client: StockClient,
  productId: string
): Promise<number> {
  const agg = await client.inventoryLocationStock.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return round2(agg._sum.quantity ?? 0);
}

/**
 * Which location a hand-out should come off.
 *
 * Preference order: a location that can cover the whole amount → the location
 * holding the most → the default location. Multi-location is the normal case
 * here (the seeds split stock 75/25), so "just use the default" would push one
 * locker negative while another sat full.
 *
 * Never blocks: if nowhere has enough, the fullest location is still chosen and
 * allowed to go short, consistent with the pickup flow.
 */
export async function pickSourceLocationId(
  tx: StockClient,
  productId: string,
  quantity: number
): Promise<string> {
  const rows = await tx.inventoryLocationStock.findMany({
    where: { productId, location: { isActive: true } },
    orderBy: { quantity: "desc" },
    select: { locationId: true, quantity: true },
  });

  const covers = rows.find((r) => r.quantity >= quantity);
  if (covers) return covers.locationId;
  if (rows.length > 0 && rows[0].quantity > 0) return rows[0].locationId;

  return ensureDefaultLocationId(tx);
}

/**
 * Recompute the cache from the truth and persist it. Internal — both public
 * writers end with this, which is what makes the invariant hold by
 * construction rather than by everyone remembering.
 */
async function syncStockLevel(
  tx: StockClient,
  productId: string
): Promise<number> {
  const total = await getWarehouseTotal(tx, productId);
  await tx.product.update({
    where: { id: productId },
    data: { stockLevel: total },
  });
  return total;
}

async function resolveUnit(
  tx: StockClient,
  productId: string,
  unit: string | null | undefined
): Promise<string | null> {
  if (typeof unit === "string") return unit;
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { unit: true },
  });
  return product?.unit ?? null;
}

/**
 * Bring ONE product's two stores back into agreement, without inventing
 * history. This is the rule `scripts/reconcileWarehouseStock.ts` applies to
 * every product, and that any writer taking an absolute total should call first
 * so it works out its delta from the truth rather than from stale drift.
 *
 * Two cases, matching `prisma/backfillLocationStock.ts`:
 *
 *   • cached stock but NO location rows → the cache is all we know, so seed the
 *     default location with it. (A product created before locations existed.)
 *   • otherwise                          → the location rows are the truth, so
 *     `stockLevel` becomes their sum.
 *
 * Writes NO `InventoryChange`: nothing physically moved, and a fabricated
 * "+8" in a product's Stock History is worse than no row at all.
 */
export async function reconcileProductStock(
  tx: StockClient,
  productId: string
): Promise<{
  /** `Product.stockLevel` before this call. */
  previousStockLevel: number;
  /** SUM of the location rows before this call. */
  locationSum: number;
  /** The agreed number afterwards — both stores now hold it. */
  stockLevel: number;
  /** True when a default-location row had to be created from the cache. */
  seeded: boolean;
  /** True when the two stores disagreed and something was written. */
  changed: boolean;
}> {
  const [product, rows] = await Promise.all([
    tx.product.findUnique({
      where: { id: productId },
      select: { stockLevel: true },
    }),
    tx.inventoryLocationStock.findMany({
      where: { productId },
      select: { quantity: true },
    }),
  ]);

  const previousStockLevel = round2(product?.stockLevel ?? 0);
  const locationSum = round2(rows.reduce((s, r) => s + r.quantity, 0));

  if (rows.length === 0 && previousStockLevel !== 0) {
    const locationId = await ensureDefaultLocationId(tx);
    await tx.inventoryLocationStock.upsert({
      where: { locationId_productId: { locationId, productId } },
      update: { quantity: previousStockLevel },
      create: { locationId, productId, quantity: previousStockLevel },
    });
    return {
      previousStockLevel,
      locationSum,
      stockLevel: previousStockLevel,
      seeded: true,
      changed: true,
    };
  }

  if (locationSum === previousStockLevel) {
    return {
      previousStockLevel,
      locationSum,
      stockLevel: previousStockLevel,
      seeded: false,
      changed: false,
    };
  }

  await tx.product.update({
    where: { id: productId },
    data: { stockLevel: locationSum },
  });
  return {
    previousStockLevel,
    locationSum,
    stockLevel: locationSum,
    seeded: false,
    changed: true,
  };
}

/**
 * Move warehouse stock by a delta.
 *
 * Applies `delta` to one location row (the default location when none is
 * named), recomputes `Product.stockLevel` from every location row, and writes
 * the warehouse-side `InventoryChange` in the SAME transaction — so the count,
 * the per-location breakdown and the audit trail can never disagree.
 *
 * A zero delta is a no-op: nothing is written, including no audit row. Callers
 * pass 0 freely (an unchanged stock field, a zero-quantity line) and should not
 * have to guard.
 *
 * Cleaner-side movement (`EmployeeProduct`) is NOT this function's business —
 * the caller writes that, plus its own kit-side audit row, alongside this call.
 */
export async function adjustWarehouseStock(
  tx: StockClient,
  args: AuditArgs & {
    productId: string;
    /** Omit to use the default location. */
    locationId?: string | null;
    /** Positive = stock arrives, negative = stock leaves. */
    delta: number;
  }
): Promise<StockResult> {
  const { productId, delta } = args;

  if (!Number.isFinite(delta) || delta === 0) {
    const [locationId, stockLevel] = await Promise.all([
      args.locationId
        ? Promise.resolve(args.locationId)
        : ensureDefaultLocationId(tx),
      getWarehouseTotal(tx, productId),
    ]);
    const row = await tx.inventoryLocationStock.findUnique({
      where: { locationId_productId: { locationId, productId } },
      select: { quantity: true },
    });
    return {
      locationId,
      locationQuantity: row?.quantity ?? 0,
      stockLevel,
      delta: 0,
    };
  }

  const locationId = args.locationId ?? (await ensureDefaultLocationId(tx));

  // upsert, not update: the location may never have carried this product.
  // Creating the row at the raw delta records the debt when that delta is
  // negative, rather than silently rejecting the movement.
  const row = await tx.inventoryLocationStock.upsert({
    where: { locationId_productId: { locationId, productId } },
    update: { quantity: { increment: delta } },
    create: { locationId, productId, quantity: delta },
    select: { quantity: true },
  });

  const stockLevel = await syncStockLevel(tx, productId);

  await tx.inventoryChange.create({
    data: {
      productId,
      // Warehouse side. The cleaner-side row, when there is one, is the
      // caller's to write — it has a different newQuantity and reason.
      employeeId: null,
      employeeName: null,
      quantityChange: round2(delta),
      newQuantity: stockLevel,
      unit: await resolveUnit(tx, productId, args.unit),
      action: args.action,
      reason: args.reason ?? null,
      changedById: args.actor?.id ?? null,
      changedByName: args.actor?.name ?? null,
    },
  });

  return {
    locationId,
    locationQuantity: round2(row.quantity),
    stockLevel,
    delta: round2(delta),
  };
}

/**
 * Set one location's quantity to an absolute number (Manage Stock, and the
 * admin's "Warehouse Stock" field once its delta has been worked out).
 *
 * Same guarantees as `adjustWarehouseStock`: the cache is recomputed from every
 * location row and the audit row records the delta this set implies, so "set to
 * 8" and "add 3" leave identical-looking history.
 */
export async function setLocationQuantity(
  tx: StockClient,
  args: AuditArgs & {
    productId: string;
    locationId: string;
    /** The location's new absolute quantity. */
    quantity: number;
  }
): Promise<StockResult> {
  const { productId, locationId, quantity } = args;

  const existing = await tx.inventoryLocationStock.findUnique({
    where: { locationId_productId: { locationId, productId } },
    select: { quantity: true },
  });
  const before = existing?.quantity ?? 0;
  const delta = round2(quantity - before);

  if (delta === 0) {
    // Saving the same number twice is a no-op, not a second audit row —
    // matching updateMyInventoryCount's rule for cleaner recounts.
    return {
      locationId,
      locationQuantity: round2(before),
      stockLevel: await getWarehouseTotal(tx, productId),
      delta: 0,
    };
  }

  await tx.inventoryLocationStock.upsert({
    where: { locationId_productId: { locationId, productId } },
    update: { quantity },
    create: { locationId, productId, quantity },
  });

  const stockLevel = await syncStockLevel(tx, productId);

  await tx.inventoryChange.create({
    data: {
      productId,
      employeeId: null,
      employeeName: null,
      quantityChange: delta,
      newQuantity: stockLevel,
      unit: await resolveUnit(tx, productId, args.unit),
      action: args.action,
      reason: args.reason ?? null,
      changedById: args.actor?.id ?? null,
      changedByName: args.actor?.name ?? null,
    },
  });

  return {
    locationId,
    locationQuantity: round2(quantity),
    stockLevel,
    delta,
  };
}
