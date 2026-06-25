"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

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
    const stocks = await db.inventoryLocationStock.findMany({
      where: {
        locationId: input.locationId,
        productId: { in: productIds },
      },
      include: { product: true },
    });

    const stockByProduct = new Map(stocks.map((s) => [s.productId, s]));

    for (const item of input.items) {
      const stock = stockByProduct.get(item.productId);
      if (!stock) {
        return {
          success: false,
          error: `Product is not stocked at this location`,
        };
      }
      if (stock.quantity < item.quantity) {
        return {
          success: false,
          error: `Only ${stock.quantity} ${stock.product.unit} of ${stock.product.name} available at this location`,
        };
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
          await tx.inventoryLocationStock.update({
            where: {
              locationId_productId: {
                locationId: input.locationId,
                productId: item.productId,
              },
            },
            data: { quantity: { decrement: item.quantity } },
          });

          // Keep the global stockLevel admins see in sync with pickups.
          await tx.product.update({
            where: { id: item.productId },
            data: { stockLevel: { decrement: item.quantity } },
          });

          await tx.employeeProduct.upsert({
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

    return { success: true, checkoutId: checkout.id };
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
