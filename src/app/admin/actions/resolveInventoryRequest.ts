"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { adjustWarehouseStock, pickSourceLocationId } from "@/lib/stock.server";

/**
 * Admin approves or rejects a cleaner's equipment/refill request.
 *
 * Approving a PRODUCT request also transfers the quantity from warehouse
 * stock to the cleaner's assigned inventory (and marks it FULFILLED). Kit
 * requests are only marked APPROVED — the admin assigns the kit through the
 * existing kit-assignment flow.
 *
 * Stage 4 (PDF #5): the warehouse side of that transfer goes through
 * `adjustWarehouseStock`, so the location row moves with the count instead of
 * `Product.stockLevel` drifting away from it. The stock the request is judged
 * against is therefore the same number the Requests tab and the Edit Product
 * modal show — which is what unblocks the "Only 0 Buckets in warehouse"
 * screenshot on p.5 while there were 8 on the shelf.
 *
 * ONCE, AND NOT BY THE REQUESTER. Every status change is a conditional update
 * on PENDING, and on the product path it is the first write in the stock
 * transaction. Two admins approving the same request both pass the read
 * above it; only one gets the row, and the other's transaction rolls back
 * before any stock moves. An owner or admin who carries a kit themselves
 * files requests like anyone else, and approving their own is handing
 * themselves warehouse stock, so that is refused.
 */

const ALREADY_RESOLVED = "Request has already been resolved";

/** Thrown inside the stock transaction to roll it back when we lost the race. */
class AlreadyResolved extends Error {}
export async function resolveInventoryRequest(
  requestId: string,
  decision: "APPROVED" | "REJECTED"
): Promise<{ success: true; status: string } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return { success: false, error: "Invalid decision" };
  }
  if (typeof requestId !== "string" || !requestId) {
    return { success: false, error: "Request not found" };
  }

  try {
    const request = await db.inventoryRequest.findUnique({
      where: { id: requestId },
      include: { product: true, employee: { select: { id: true, name: true } } },
    });
    if (!request) return { success: false, error: "Request not found" };
    if (request.employeeId === session.user.id) {
      return {
        success: false,
        error: "You can't resolve your own request. Another admin has to.",
      };
    }
    if (request.status !== "PENDING") {
      return { success: false, error: ALREADY_RESOLVED };
    }

    if (decision === "REJECTED") {
      const res = await db.inventoryRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "REJECTED" },
      });
      if (res.count === 0) return { success: false, error: ALREADY_RESOLVED };
    } else if (request.productId && request.product) {
      // Block ONLY when the warehouse is genuinely short (Stage 4.4). This is
      // the maintained cache, which every writer now keeps equal to
      // SUM(location rows) — so the number in this message is the same one the
      // Requests tab warns with and the Edit Product modal shows.
      if (request.product.stockLevel < request.quantity) {
        return {
          success: false,
          error:
            `Only ${request.product.stockLevel} ${request.product.unit} of ` +
            `${request.product.name} in the warehouse — this request needs ${request.quantity}.`,
        };
      }
      const actor = session.user as { id?: string; name?: string };
      const productId = request.productId;
      const product = request.product;

      await db.$transaction(async (tx) => {
        // First, so a request someone else already fulfilled moves no stock:
        // the throw rolls this whole transaction back.
        const claimed = await tx.inventoryRequest.updateMany({
          where: { id: requestId, status: "PENDING" },
          data: { status: "FULFILLED" },
        });
        if (claimed.count === 0) throw new AlreadyResolved();

        // Multi-location is the normal case (the seeds split stock 75/25), so
        // the units have to leave a real shelf rather than always the default
        // one — otherwise approving a request pushes one locker negative while
        // another sits full.
        const locationId = await pickSourceLocationId(
          tx,
          productId,
          request.quantity
        );
        const location = await tx.inventoryLocation.findUnique({
          where: { id: locationId },
          select: { name: true },
        });

        await adjustWarehouseStock(tx, {
          productId,
          locationId,
          delta: -request.quantity,
          action: "REQUEST_FULFILLED",
          unit: product.unit,
          reason:
            `Fulfilled refill request for ${request.employee?.name ?? "cleaner"}` +
            (location ? ` — ${location.name}` : ""),
          actor,
        });

        const kitRow = await tx.employeeProduct.upsert({
          where: {
            employeeId_productId: {
              employeeId: request.employeeId,
              productId,
            },
          },
          update: { quantity: { increment: request.quantity } },
          create: {
            employeeId: request.employeeId,
            productId,
            quantity: request.quantity,
          },
          select: { quantity: true },
        });

        // The matching increment on the cleaner's assigned stock. The warehouse
        // side's audit row is written by `adjustWarehouseStock` above.
        await tx.inventoryChange.create({
          data: {
            productId,
            employeeId: request.employeeId,
            employeeName: request.employee?.name ?? null,
            quantityChange: request.quantity,
            newQuantity: kitRow.quantity,
            unit: product.unit,
            action: "REQUEST_FULFILLED",
            reason: "Refill request approved",
            changedById: actor.id ?? null,
            changedByName: actor.name ?? null,
          },
        });
      }, {
        // Approving runs eight sequential queries (source location, its name,
        // the location upsert, the SUM, the cache write, the warehouse audit
        // row, the kit upsert, the kit audit row). Against a pooled Supabase
        // connection that comfortably outruns Prisma's default 5s window, and
        // the transaction is already closed by the time the last write goes —
        // P2028 from `inventoryChange.create`, the whole approval rolled back,
        // and a 200 the admin reads as success. Same budget the other
        // multi-query stock movements use.
        maxWait: 10_000,
        timeout: 30_000,
      });
    } else {
      // Kit request — approve only; assignment happens via the kit flow.
      const res = await db.inventoryRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "APPROVED" },
      });
      if (res.count === 0) return { success: false, error: ALREADY_RESOLVED };
    }

    revalidatePath(`/admin/employees/${request.employeeId}`);
    revalidatePath("/admin/inventory");
    revalidatePath("/cleaners/my-inventory");
    // Manage Stock lives on Settings and reads the location rows this just
    // moved — without this it keeps showing the pre-approval number (Stage 4.5).
    revalidatePath("/admin/settings");

    return {
      success: true,
      status: decision === "REJECTED" ? "REJECTED" : request.productId ? "FULFILLED" : "APPROVED",
    };
  } catch (error) {
    if (error instanceof AlreadyResolved) {
      return { success: false, error: ALREADY_RESOLVED };
    }
    console.error("Error resolving inventory request:", error);
    return { success: false, error: "Failed to resolve request" };
  }
}
