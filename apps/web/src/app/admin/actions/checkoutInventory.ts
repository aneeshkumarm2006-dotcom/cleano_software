"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { adjustWarehouseStock } from "@/lib/stock.server";

interface CheckoutInventoryInput {
  locationId: string;
  notes?: string;
  items: { productId: string; quantity: number }[];
}

export async function checkoutInventory(input: CheckoutInventoryInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  if (!input.locationId) {
    return { success: false, error: "Location is required" };
  }

  if (!input.items || input.items.length === 0) {
    return { success: false, error: "Cart is empty" };
  }

  for (const item of input.items) {
    if (!item.productId) {
      return { success: false, error: "Invalid product in cart" };
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return {
        success: false,
        error: "Quantity must be greater than zero for every item",
      };
    }
  }

  try {
    const location = await db.inventoryLocation.findUnique({
      where: { id: input.locationId },
    });
    if (!location || !location.isActive) {
      return { success: false, error: "Location not found" };
    }

    const productIds = input.items.map((i) => i.productId);

    // Products are loaded independently of location stock: a cleaner may pick up
    // something this location has never carried a stock row for, and that must
    // not block them (fix list items 5 + 19).
    const products = await db.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const missing = input.items.filter((i) => !productById.has(i.productId));
    if (missing.length > 0) {
      // A product that doesn't exist is a bad request, not a stock problem.
      return { success: false, error: "One or more products no longer exist" };
    }

    const stocks = await db.inventoryLocationStock.findMany({
      where: {
        locationId: input.locationId,
        productId: { in: productIds },
      },
    });
    const stockByProduct = new Map(stocks.map((s) => [s.productId, s]));

    // Low/zero stock is a WARNING, never a block. Supplies are routinely
    // restocked or handed out outside the app, so the locker count is an
    // estimate — letting it go negative and reconciling later is correct, and
    // is far better than stranding a cleaner who needs product for a job.
    const warnings: string[] = [];
    for (const item of input.items) {
      const product = productById.get(item.productId)!;
      const available = stockByProduct.get(item.productId)?.quantity ?? 0;
      if (available < item.quantity) {
        const after = available - item.quantity;
        warnings.push(
          `${product.name}: ${available} ${product.unit} on record at this location, ` +
            `taking ${item.quantity} — locker will show ${after} and is flagged for admin review.`
        );
      }
    }

    const checkout = await db.$transaction(
      async (tx) => {
        const created = await tx.inventoryCheckout.create({
          data: {
            employeeId: session.user.id,
            locationId: input.locationId,
            notes: input.notes ?? null,
            items: {
              create: input.items.map((i) => ({
                productId: i.productId,
                quantity: i.quantity,
              })),
            },
          },
        });

        for (const item of input.items) {
          const product = productById.get(item.productId)!;

          // Stage 4: one call now does what this used to do in two — decrement
          // THIS location's row (upserting it negative when the location never
          // carried the product, which is what keeps a cleaner from being
          // stranded, fix list item 5), recompute `Product.stockLevel` from
          // every location row, and write the warehouse audit row. Doing both
          // stores here by hand is exactly how they came apart.
          await adjustWarehouseStock(tx, {
            productId: item.productId,
            locationId: input.locationId,
            delta: -item.quantity,
            action: "PICKUP",
            unit: product.unit,
            reason: `Warehouse pickup by ${session.user.name ?? "cleaner"} — ${location.name}`,
            actor: { id: session.user.id, name: session.user.name ?? null },
          });

          const kitRow = await tx.employeeProduct.upsert({
            where: {
              employeeId_productId: {
                employeeId: session.user.id,
                productId: item.productId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              employeeId: session.user.id,
              productId: item.productId,
              quantity: item.quantity,
            },
          });

          // Unified audit trail (spec item 15): pickups appear in the same
          // Stock History as every other change. This is the cleaner's side (+);
          // the warehouse side (−) is written by `adjustWarehouseStock` above,
          // which is the only thing that knows the post-move total.
          await tx.inventoryChange.create({
            data: {
              productId: item.productId,
              employeeId: session.user.id,
              employeeName: session.user.name ?? null,
              quantityChange: item.quantity,
              newQuantity: kitRow.quantity,
              unit: product.unit,
              action: "PICKUP",
              reason: `Warehouse pickup — ${location.name}`,
              changedById: session.user.id,
              changedByName: session.user.name ?? null,
            },
          });
        }

        return created;
      },
      {
        // Each item runs 3 sequential queries; with Supabase round-trip latency
        // the default 5s window is easy to blow past. Give it room.
        maxWait: 10_000,
        timeout: 30_000,
      }
    );

    revalidatePath("/cleaners/my-inventory");
    revalidatePath("/cleaners/my-inventory/checkout");
    revalidatePath("/cleaners/my-inventory/history");
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/settings");

    // `warnings` is non-empty when the locker went low/negative. The pickup
    // still succeeded — the UI shows these for information and the admin
    // inventory view flags the negative rows for reconciliation.
    return { success: true, checkoutId: checkout.id, warnings };
  } catch (error: unknown) {
    console.error("Error during checkout:", error);
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error ?? "unknown error");
    return { success: false, error: `Checkout failed: ${detail}` };
  }
}
