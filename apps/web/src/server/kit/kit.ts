// My kit: the caller's own supplies and tools (kit.ts in @bookmops/api).
//
// Every function here acts on the CALLER's kit: the kit row is always looked
// up by (actor.userId, productId), never by an id from the request, so there
// is nothing to point at another cleaner's kit. The web's cleaner actions
// (addMyInventoryItem, updateMyInventoryCount, updateMyItemCondition,
// createInventoryRequest, getLocationProducts, checkoutInventory) are thin
// adapters over these, keeping their own messages. Reporting an issue is
// ./issue.ts.
import "server-only";

import { Prisma } from "@prisma/client";
import type { KitItem } from "@bookmops/api/v1";
import {
  cleanerRestockThreshold,
  conditionFlagType,
  EQUIPMENT_CONDITION_LABEL,
  itemAttentionState,
  type EquipmentCondition,
} from "@bookmops/core/inventory";

import { loadCleanerThresholdDefault } from "@/lib/inventory-thresholds.server";
import { ASSIGNABLE_PRODUCT_WHERE, findAssignableProduct, PRODUCT_NOT_FOUND } from "@/lib/kit-product.server";
import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";
import { adjustWarehouseStock } from "@/lib/stock.server";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Failure, type Result } from "../result";

export const MAX_KIT_QUANTITY = 1000;
const MAX_NOTE_LEN = 300;

/** Room for a multi-query stock movement over a pooled connection (see checkoutInventory). */
export const STOCK_TX = { maxWait: 10_000, timeout: 30_000 } as const;

export const NOT_IN_KIT = "This item is not in your kit";

/** A product lookup failure, as a Result: gone is 404, archived is 409. */
export function productFailure(error: string): Failure {
  return error === PRODUCT_NOT_FOUND
    ? notFound(PRODUCT_NOT_FOUND)
    : failure(409, "PRODUCT_ARCHIVED", error);
}

// ── Reading the kit ─────────────────────────────────────────────────────────

const KIT_ROW_INCLUDE = {
  product: {
    select: {
      name: true,
      description: true,
      unit: true,
      itemType: true,
      cleanerRestockThreshold: true,
    },
  },
} as const;

type KitRow = Prisma.EmployeeProductGetPayload<{ include: typeof KIT_ROW_INCLUDE }>;

function toKitItem(
  ep: KitRow,
  defaultThreshold: number,
  pending: { quantity: number; createdAt: Date } | undefined,
): KitItem {
  const thresholdInput = {
    cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
    defaultThreshold,
    itemType: ep.product.itemType,
  };
  // The web's one classification (my-inventory/page.tsx), never re-derived.
  const attention = itemAttentionState({
    ...thresholdInput,
    quantity: ep.quantity,
    condition: ep.condition,
    levelStatus: ep.levelStatus,
  });
  return {
    productId: ep.productId,
    name: ep.product.name,
    description: ep.product.description,
    unit: ep.product.unit,
    quantity: ep.quantity,
    itemType: ep.product.itemType,
    refillAt: ep.product.itemType === "REUSABLE_EQUIPMENT" ? null : cleanerRestockThreshold(thresholdInput),
    attention: {
      kind: attention.kind,
      tone: attention.tone,
      label: attention.label,
      needsAttention: attention.needsAttention,
    },
    level: ep.levelStatus ?? null,
    condition: ep.condition ?? null,
    statusNote: ep.statusNotes ?? null,
    statusUpdatedAt: ep.statusUpdatedAt ? ep.statusUpdatedAt.toISOString() : null,
    updatedAt: ep.updatedAt.toISOString(),
    pendingRequest: pending ? { quantity: pending.quantity, requestedAt: pending.createdAt.toISOString() } : null,
  };
}

async function kitItems(actor: Actor, productId?: string): Promise<KitItem[]> {
  const [rows, pending, defaultThreshold] = await Promise.all([
    db.employeeProduct.findMany({
      where: { employeeId: actor.userId, ...(productId ? { productId } : {}) },
      include: KIT_ROW_INCLUDE,
      orderBy: [{ product: { name: "asc" } }, { productId: "asc" }],
    }),
    db.inventoryRequest.findMany({
      where: {
        employeeId: actor.userId,
        status: "PENDING",
        ...(productId ? { productId } : { productId: { not: null } }),
      },
      select: { productId: true, quantity: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    loadCleanerThresholdDefault(),
  ]);
  const pendingBy = new Map<string, { quantity: number; createdAt: Date }>();
  for (const r of pending) if (r.productId && !pendingBy.has(r.productId)) pendingBy.set(r.productId, r);
  return rows.map((ep) => toKitItem(ep, defaultThreshold, pendingBy.get(ep.productId)));
}

/** GET /kit: the caller's kit by name, and how many items need attention. */
export async function listKit(actor: Actor): Promise<Result<{ items: KitItem[]; needsAttention: number }>> {
  const items = await kitItems(actor);
  return ok({ items, needsAttention: items.filter((i) => i.attention.needsAttention).length });
}

/** One of the caller's kit items as it now stands, or 404. */
export async function kitItem(actor: Actor, productId: string): Promise<Result<KitItem>> {
  const [item] = await kitItems(actor, productId);
  return item ? ok(item) : notFound(NOT_IN_KIT);
}

/** GET /kit/catalog: active products not already in the caller's kit. Name and unit only. */
export async function kitCatalog(
  actor: Actor,
): Promise<Result<{ items: { productId: string; name: string; unit: string }[] }>> {
  const [products, mine] = await Promise.all([
    db.product.findMany({
      where: ASSIGNABLE_PRODUCT_WHERE,
      select: { id: true, name: true, unit: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.employeeProduct.findMany({ where: { employeeId: actor.userId }, select: { productId: true } }),
  ]);
  const have = new Set(mine.map((m) => m.productId));
  return ok({
    items: products.filter((p) => !have.has(p.id)).map((p) => ({ productId: p.id, name: p.name, unit: p.unit })),
  });
}

// ── Adding, recounting, condition ───────────────────────────────────────────

export const ALREADY_IN_KIT = "Already in your kit — use Update count instead";

/**
 * Record an item the caller already has on hand. Creates their kit row only
 * (company stock untouched) and a RECOUNT audit row. The product must be
 * assignable; one already in the kit is 409 ALREADY_IN_KIT.
 */
export async function addKitItem(
  actor: Actor,
  input: { productId: string; quantity: number },
): Promise<Result<{ productId: string }>> {
  const qty = input.quantity;
  if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_KIT_QUANTITY) {
    return failure(400, "VALIDATION_FAILED", `Enter a quantity between 1 and ${MAX_KIT_QUANTITY}`);
  }
  const lookup = await findAssignableProduct(input.productId);
  if (!lookup.ok) return productFailure(lookup.error);
  const product = lookup.product;

  try {
    await db.$transaction(async (tx) => {
      await tx.employeeProduct.create({
        data: { employeeId: actor.userId, productId: product.id, quantity: qty },
      });
      await tx.inventoryChange.create({
        data: {
          productId: product.id,
          employeeId: actor.userId,
          employeeName: actor.name,
          quantityChange: qty,
          newQuantity: qty,
          unit: product.unit,
          action: "RECOUNT",
          reason: "Starting inventory set by cleaner",
          changedById: actor.userId,
          changedByName: actor.name,
        },
      });
    });
  } catch (e) {
    // The unique (employee, product) row: already there, or a second tap won.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return failure(409, "ALREADY_IN_KIT", ALREADY_IN_KIT);
    }
    throw e;
  }
  return ok({ productId: product.id });
}

/**
 * A recount of the caller's own item. Company stock untouched; a RECOUNT
 * audit row with the reason. Saving the number already on record is a no-op.
 */
export async function setKitCount(
  actor: Actor,
  input: { productId: string; quantity: number; reason: string },
): Promise<Result<{ quantity: number; changed: boolean }>> {
  const qty = input.quantity;
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_KIT_QUANTITY) {
    return failure(400, "VALIDATION_FAILED", `Enter a count between 0 and ${MAX_KIT_QUANTITY}`);
  }
  const reason = input.reason.trim().slice(0, MAX_NOTE_LEN);
  if (!reason) return failure(400, "VALIDATION_FAILED", "Add a short reason for the correction");

  const kit = await db.employeeProduct.findUnique({
    where: { employeeId_productId: { employeeId: actor.userId, productId: input.productId } },
    include: { product: { select: { unit: true } } },
  });
  if (!kit) return notFound(NOT_IN_KIT);

  const delta = qty - kit.quantity;
  if (delta === 0) return ok({ quantity: qty, changed: false });

  await db.$transaction(async (tx) => {
    await tx.employeeProduct.update({ where: { id: kit.id }, data: { quantity: qty } });
    await tx.inventoryChange.create({
      data: {
        productId: kit.productId,
        employeeId: actor.userId,
        employeeName: actor.name,
        quantityChange: delta,
        newQuantity: qty,
        unit: kit.product.unit,
        action: "RECOUNT",
        reason: `Cleaner recount: ${reason}`,
        changedById: actor.userId,
        changedByName: actor.name,
      },
    });
  });
  return ok({ quantity: qty, changed: true });
}

/**
 * How a tool is. Only REUSABLE_EQUIPMENT (409 NOT_EQUIPMENT otherwise). Moves
 * no stock: the condition, a STATUS_REPORT audit row, and one OPEN review flag
 * per (cleaner, product, type) for anything but AVAILABLE, resolving the rest.
 */
export async function setKitCondition(
  actor: Actor,
  input: { productId: string; condition: EquipmentCondition; note?: string | null; now: Date },
): Promise<Result<{ condition: EquipmentCondition }>> {
  const note = input.note?.trim().slice(0, MAX_NOTE_LEN) || null;
  const kit = await db.employeeProduct.findUnique({
    where: { employeeId_productId: { employeeId: actor.userId, productId: input.productId } },
    include: { product: { select: { name: true, unit: true, itemType: true } } },
  });
  if (!kit) return notFound(NOT_IN_KIT);
  if (kit.product.itemType !== "REUSABLE_EQUIPMENT") {
    return failure(409, "NOT_EQUIPMENT", "Condition reporting only applies to reusable equipment");
  }

  const previous = kit.condition ?? null;
  const next = input.condition;
  const flagType = conditionFlagType(next);
  const now = input.now;

  await db.$transaction(async (tx) => {
    await tx.employeeProduct.update({
      where: { id: kit.id },
      data: { condition: next, statusUpdatedAt: now, statusNotes: note },
    });
    await tx.inventoryChange.create({
      data: {
        productId: kit.productId,
        employeeId: actor.userId,
        employeeName: actor.name,
        quantityChange: 0,
        newQuantity: kit.quantity,
        unit: kit.product.unit,
        action: "STATUS_REPORT",
        previousStatus: previous,
        newStatus: next,
        reason:
          `Condition reported by cleaner: ` +
          `${previous ? `${EQUIPMENT_CONDITION_LABEL[previous]} → ` : ""}` +
          `${EQUIPMENT_CONDITION_LABEL[next]}` +
          (note ? ` — ${note}` : ""),
        changedById: actor.userId,
        changedByName: actor.name,
      },
    });
    if (flagType) {
      const existing = await tx.inventoryFlag.findFirst({
        where: { employeeId: actor.userId, productId: kit.productId, type: flagType, status: "OPEN" },
        select: { id: true },
      });
      if (existing) {
        await tx.inventoryFlag.update({ where: { id: existing.id }, data: { notes: note } });
      } else {
        await tx.inventoryFlag.create({
          data: { type: flagType, employeeId: actor.userId, productId: kit.productId, source: "RECOUNT", notes: note },
        });
      }
    }
    await tx.inventoryFlag.updateMany({
      where: {
        employeeId: actor.userId,
        productId: kit.productId,
        status: "OPEN",
        ...(flagType ? { type: { not: flagType } } : {}),
      },
      data: { status: "RESOLVED", resolvedAt: now, resolvedById: actor.userId },
    });
  });
  return ok({ condition: next });
}

// ── Restock requests ────────────────────────────────────────────────────────

export interface RestockLine {
  productId: string;
  quantity: number;
}

export interface RestockResult {
  productId: string;
  outcome: "CREATED" | "ALREADY_PENDING";
  request: { id: string; quantity: number; status: string; createdAt: Date };
}

/**
 * Ask the office to restock, once per line, in one transaction. Each product
 * must be assignable. A product with a PENDING request from this caller is not
 * requested again (ALREADY_PENDING): the lines run under a lock on the caller,
 * so two taps at once can't both create one. One LOW_INVENTORY alert per
 * created line. Duplicate products in one request are refused.
 */
export async function requestRestock(
  actor: Actor,
  input: { items: RestockLine[]; reason: string },
): Promise<Result<{ results: RestockResult[] }>> {
  if (input.items.length === 0) return failure(400, "VALIDATION_FAILED", "Pick at least one item");
  const ids = input.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) return failure(400, "VALIDATION_FAILED", "Each item can only be requested once.");
  for (const i of input.items) {
    if (!Number.isFinite(i.quantity) || i.quantity <= 0) {
      return failure(400, "VALIDATION_FAILED", "Quantity must be greater than zero");
    }
  }

  const orgId = await requireOrgId();
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kit-restock:${orgId}:${actor.userId}`}))`;
    const results: RestockResult[] = [];
    for (const line of input.items) {
      const lookup = await findAssignableProduct(line.productId, tx);
      if (!lookup.ok) return { failed: productFailure(lookup.error) };
      const product = lookup.product;
      const existing = await tx.inventoryRequest.findFirst({
        where: { employeeId: actor.userId, status: "PENDING", productId: product.id },
        select: { id: true, quantity: true, status: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        results.push({ productId: product.id, outcome: "ALREADY_PENDING", request: existing });
        continue;
      }
      const request = await tx.inventoryRequest.create({
        data: {
          employeeId: actor.userId,
          productId: product.id,
          quantity: line.quantity,
          reason: input.reason,
          status: "PENDING",
        },
        select: { id: true, quantity: true, status: true, createdAt: true },
      });
      await tx.alert.create({
        data: {
          type: "LOW_INVENTORY",
          severity: "WARNING",
          title: `Equipment requested: ${product.name}`,
          message: `${actor.name ?? "A cleaner"} requested ${line.quantity} ${product.unit} of ${product.name}`,
          relatedId: product.id,
          relatedType: "Product",
          employeeId: actor.userId,
        },
      });
      results.push({ productId: product.id, outcome: "CREATED", request });
    }
    return { results };
  }, STOCK_TX);
  if ("failed" in outcome) return outcome.failed!;
  return ok({ results: outcome.results });
}

// ── Storage locations and pickups ───────────────────────────────────────────

export async function listKitLocations(): Promise<
  Result<{ items: { id: string; name: string; address: string | null }[] }>
> {
  const rows = await db.inventoryLocation.findMany({
    where: { isActive: true },
    select: { id: true, name: true, address: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return ok({ items: rows });
}

export interface LocationProduct {
  productId: string;
  name: string;
  description: string | null;
  unit: string;
  available: number;
  minStock: number;
}

/**
 * What can be picked up at a location: EVERY active product, with what the
 * location has on record (0 or below is an estimate, never a block). An
 * inactive or unknown location is 404.
 */
export async function locationProducts(
  locationId: string,
): Promise<Result<{ location: { id: string; name: string; address: string | null }; items: LocationProduct[] }>> {
  if (typeof locationId !== "string" || !locationId) return notFound("Location not found");
  const location = await db.inventoryLocation.findFirst({
    where: { id: locationId, isActive: true },
    select: { id: true, name: true, address: true },
  });
  if (!location) return notFound("Location not found");
  const [products, stocks] = await Promise.all([
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, description: true, unit: true, minStock: true },
    }),
    db.inventoryLocationStock.findMany({ where: { locationId }, select: { productId: true, quantity: true } }),
  ]);
  const qty = new Map(stocks.map((s) => [s.productId, s.quantity]));
  return ok({
    location,
    items: products.map((p) => ({
      productId: p.id,
      name: p.name,
      description: p.description,
      unit: p.unit,
      available: qty.get(p.id) ?? 0,
      minStock: p.minStock,
    })),
  });
}

/**
 * "I took these from storage", in one transaction: takes each line off the
 * location's stock (short stock warns, never refuses), adds it to the CALLER's
 * kit, and writes PICKUP audit rows on both sides. Products must exist and not
 * be archived; a product listed twice is refused.
 */
export async function pickUp(
  actor: Actor,
  input: { locationId: string; items: { productId: string; quantity: number }[]; note?: string | null },
): Promise<Result<{ pickupId: string; warnings: string[] }>> {
  if (!input.locationId) return failure(400, "VALIDATION_FAILED", "Location is required");
  if (!input.items || input.items.length === 0) return failure(400, "VALIDATION_FAILED", "Cart is empty");
  for (const item of input.items) {
    if (!item.productId) return failure(400, "VALIDATION_FAILED", "Invalid product in cart");
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return failure(400, "VALIDATION_FAILED", "Quantity must be greater than zero for every item");
    }
  }
  const productIds = input.items.map((i) => i.productId);
  if (new Set(productIds).size !== productIds.length) {
    return failure(400, "VALIDATION_FAILED", "Each product can only be in the cart once.");
  }

  const location = await db.inventoryLocation.findFirst({
    where: { id: input.locationId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) return notFound("Location not found");

  const products = await db.product.findMany({
    where: { id: { in: productIds }, deletedAt: null },
    select: { id: true, name: true, unit: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  if (input.items.some((i) => !productById.has(i.productId))) {
    return failure(400, "PRODUCT_UNAVAILABLE", "One or more products no longer exist");
  }

  const stocks = await db.inventoryLocationStock.findMany({
    where: { locationId: location.id, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  const stockBy = new Map(stocks.map((s) => [s.productId, s.quantity]));
  const warnings: string[] = [];
  for (const item of input.items) {
    const product = productById.get(item.productId)!;
    const available = stockBy.get(item.productId) ?? 0;
    if (available < item.quantity) {
      warnings.push(
        `${product.name}: ${available} ${product.unit} on record at this location, ` +
          `taking ${item.quantity} — locker will show ${available - item.quantity} and is flagged for admin review.`,
      );
    }
  }

  const note = input.note?.trim().slice(0, MAX_NOTE_LEN) || null;
  const checkout = await db.$transaction(async (tx) => {
    const created = await tx.inventoryCheckout.create({
      data: {
        employeeId: actor.userId,
        locationId: location.id,
        notes: note,
        items: { create: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
      },
      select: { id: true },
    });
    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      await adjustWarehouseStock(tx, {
        productId: item.productId,
        locationId: location.id,
        delta: -item.quantity,
        action: "PICKUP",
        unit: product.unit,
        reason: `Warehouse pickup by ${actor.name ?? "cleaner"} — ${location.name}`,
        actor: { id: actor.userId, name: actor.name },
      });
      const kitRow = await tx.employeeProduct.upsert({
        where: { employeeId_productId: { employeeId: actor.userId, productId: item.productId } },
        update: { quantity: { increment: item.quantity } },
        create: { employeeId: actor.userId, productId: item.productId, quantity: item.quantity },
      });
      await tx.inventoryChange.create({
        data: {
          productId: item.productId,
          employeeId: actor.userId,
          employeeName: actor.name,
          quantityChange: item.quantity,
          newQuantity: kitRow.quantity,
          unit: product.unit,
          action: "PICKUP",
          reason: `Warehouse pickup — ${location.name}`,
          changedById: actor.userId,
          changedByName: actor.name,
        },
      });
    }
    return created;
  }, STOCK_TX);

  return ok({ pickupId: checkout.id, warnings });
}
