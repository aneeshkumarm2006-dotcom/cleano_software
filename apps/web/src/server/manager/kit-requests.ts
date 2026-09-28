// The office's kit-restock queue and deciding one
// (packages/api/src/v1/manager-approvals.ts, "Kit restocks").
//
// One implementation, two front doors: the web's resolveInventoryRequest is
// a thin adapter over resolveKitRequest below, and so is the phone's
// POST /manager/kit-requests/:id/decision.
//
// ONCE, AND NOT BY THE REQUESTER. The claim (a conditional update on PENDING,
// manager-access.ts rule 10) is the first write of one transaction; for a
// product it is followed, in the same transaction, by the warehouse check
// (the product row locked, so two requests for the last units can't both
// pass it) and the stock movement with both audit rows. A short warehouse
// rolls the claim back, so the request stays PENDING. Two approvals at once:
// exactly one claims it and moves stock; a replayed phone request is answered
// from its idempotency record and moves nothing.
import "server-only";

import type { KitRequestItem, KitRequestsResponse } from "@bookmops/api/v1";
import { can } from "@bookmops/api/v1";
import type { Prisma } from "@prisma/client";

import { logActivity } from "@/lib/activity-log";
import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";
import { adjustWarehouseStock, pickSourceLocationId } from "@/lib/stock.server";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Failure, type Result } from "../result";
import { afterKeyset, badCursor, decodeKeyset, pageBy } from "./cursor";

export const ALREADY_RESOLVED = "Request has already been resolved";
export const SELF_KIT_REQUEST = "You can't resolve your own request. Another admin has to.";
const NOT_FOUND = "Request not found";
const FORBIDDEN = "Your role can't do this.";
const PAGE_SIZE = 30;

const ROW_SELECT = {
  id: true,
  employeeId: true,
  productId: true,
  kitId: true,
  quantity: true,
  reason: true,
  status: true,
  createdAt: true,
  employee: { select: { name: true } },
  product: { select: { id: true, name: true, unit: true, stockLevel: true } },
  kitTemplate: { select: { id: true, name: true } },
} as const satisfies Prisma.InventoryRequestSelect;
type Row = Prisma.InventoryRequestGetPayload<{ select: typeof ROW_SELECT }>;

function toItem(r: Row): KitRequestItem {
  return {
    id: r.id,
    employee: { id: r.employeeId, name: r.employee.name },
    product: r.product
      ? { id: r.product.id, name: r.product.name, unit: r.product.unit, inWarehouse: r.product.stockLevel }
      : null,
    kit: r.kitTemplate ? { id: r.kitTemplate.id, name: r.kitTemplate.name } : null,
    quantity: r.quantity,
    reason: r.reason,
    status: r.status,
    requestedAt: r.createdAt.toISOString(),
  } as KitRequestItem;
}

/** GET /manager/kit-requests: PENDING, oldest first, never the caller's own. */
export async function listKitRequestsFor(actor: Actor, cursorRaw: string | undefined): Promise<Result<KitRequestsResponse>> {
  if (!can(actor.role, "KIT_REQUESTS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const rows = await db.inventoryRequest.findMany({
    where: {
      AND: [{ status: "PENDING", employeeId: { not: actor.userId } }, afterKeyset("createdAt", "asc", cursor)],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    select: ROW_SELECT,
  });
  const page = pageBy(rows, PAGE_SIZE, (r) => ({ at: r.createdAt, id: r.id }));
  return ok({ items: page.rows.map(toItem), nextCursor: page.nextCursor });
}

/** The Approvals badge's kit count. */
export async function pendingKitCount(actor: Actor): Promise<number> {
  return db.inventoryRequest.count({ where: { status: "PENDING", employeeId: { not: actor.userId } } });
}

class Refusal extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
  }
}

/**
 * Approve or reject one restock request. `actorName` and `actorId` land on
 * both stock audit rows, as the web's action wrote them.
 */
export async function resolveKitRequest(
  actor: Actor,
  id: string,
  decision: "APPROVE" | "REJECT",
  via: "web" | "app",
): Promise<Result<KitRequestItem>> {
  if (!can(actor.role, "KIT_REQUESTS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const request = await db.inventoryRequest.findFirst({ where: { id }, select: ROW_SELECT });
  if (!request) return notFound(NOT_FOUND);
  if (request.employeeId === actor.userId) return failure(403, "SELF_APPROVAL", SELF_KIT_REQUEST);
  if (request.status !== "PENDING") return failure(409, "ALREADY_RESOLVED", ALREADY_RESOLVED);

  const organizationId = await requireOrgId();
  const auditActor = { id: actor.userId, name: actor.name ?? undefined };
  const next = decision === "REJECT" ? "REJECTED" : request.productId ? "FULFILLED" : "APPROVED";

  try {
    await db.$transaction(
      async (tx) => {
        // First, so a request someone else already resolved moves no stock.
        const claimed = await tx.inventoryRequest.updateMany({
          where: { id, status: "PENDING" },
          data: { status: next },
        });
        if (claimed.count === 0) throw new Refusal(failure(409, "ALREADY_RESOLVED", ALREADY_RESOLVED));
        if (next !== "FULFILLED") return;

        const productId = request.productId!;
        // The product row locked, then its stock read under the lock: two
        // requests for the last units can't both pass the check.
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const product = await tx.product.findFirst({
          where: { id: productId },
          select: { name: true, unit: true, stockLevel: true },
        });
        if (!product) throw new Refusal(failure(409, "ALREADY_RESOLVED", "That product no longer exists."));
        // Block ONLY when the warehouse is genuinely short (Stage 4.4), with
        // the web's words; the throw rolls the claim back, so it stays PENDING.
        if (product.stockLevel < request.quantity) {
          throw new Refusal(
            failure(
              409,
              "WAREHOUSE_SHORT",
              `Only ${product.stockLevel} ${product.unit} of ${product.name} in the warehouse — this request needs ${request.quantity}.`,
            ),
          );
        }

        // The units leave a real shelf, not always the default one.
        const locationId = await pickSourceLocationId(tx, productId, request.quantity);
        const location = await tx.inventoryLocation.findFirst({ where: { id: locationId }, select: { name: true } });
        await adjustWarehouseStock(tx, {
          productId,
          locationId,
          delta: -request.quantity,
          action: "REQUEST_FULFILLED",
          unit: product.unit,
          reason:
            `Fulfilled refill request for ${request.employee.name ?? "cleaner"}` +
            (location ? ` — ${location.name}` : "") +
            (via === "app" ? " (from the app)" : ""),
          actor: auditActor,
        });
        const kitRow = await tx.employeeProduct.upsert({
          where: { employeeId_productId: { employeeId: request.employeeId, productId } },
          update: { quantity: { increment: request.quantity } },
          create: { employeeId: request.employeeId, productId, quantity: request.quantity },
          select: { quantity: true },
        });
        // The matching increment on the cleaner's kit; the warehouse side's
        // audit row is adjustWarehouseStock's.
        await tx.inventoryChange.create({
          data: {
            productId,
            employeeId: request.employeeId,
            employeeName: request.employee.name ?? null,
            quantityChange: request.quantity,
            newQuantity: kitRow.quantity,
            unit: product.unit,
            action: "REQUEST_FULFILLED",
            reason: "Refill request approved",
            changedById: actor.userId,
            changedByName: actor.name ?? null,
          },
        });
      },
      // Eight sequential statements against a pooled connection: the budget
      // the web's stock movements use.
      { maxWait: 10_000, timeout: 30_000 },
    );
  } catch (e) {
    if (e instanceof Refusal) return e.failure;
    throw e;
  }

  await logActivity({
    category: "ADMIN",
    action: `inventory.request.${next.toLowerCase()}`,
    status: "SUCCESS",
    actorId: actor.userId,
    actorLabel: actor.name,
    targetType: "InventoryRequest",
    targetId: id,
    message:
      `${actor.name ?? "An admin"} ${decision === "REJECT" ? "rejected" : "approved"} ` +
      `${request.employee.name}'s request for ${request.quantity} × ` +
      `${request.product?.name ?? request.kitTemplate?.name ?? "an item"}` +
      (via === "app" ? " from the app." : "."),
  }).catch(() => {});

  const now = await db.inventoryRequest.findFirst({ where: { id }, select: ROW_SELECT });
  if (!now) return notFound(NOT_FOUND);
  return ok(toItem(now));
}
