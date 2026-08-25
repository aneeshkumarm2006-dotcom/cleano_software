"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { LocationProductEntry } from "./getLocationProducts.types";

export async function getLocationProducts(
  locationId: string
): Promise<
  | {
      success: true;
      location: { id: string; name: string; address: string | null };
      products: LocationProductEntry[];
    }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  if (!locationId) {
    return { success: false, error: "Location is required" };
  }

  try {
    const location = await db.inventoryLocation.findUnique({
      where: { id: locationId },
    });

    if (!location || !location.isActive) {
      return { success: false, error: "Location not found" };
    }

    // EVERY active product is listed, not just the ones this location currently
    // has stock for. Hiding out-of-stock items was a hard block by omission: a
    // cleaner could not pick up something that had been restocked outside the
    // app, and had no way to record that they took it (fix list items 5 + 19).
    const [products, stocks] = await Promise.all([
      db.product.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          unit: true,
          minStock: true,
        },
      }),
      db.inventoryLocationStock.findMany({
        where: { locationId },
        select: { productId: true, quantity: true },
      }),
    ]);

    const qtyByProduct = new Map(stocks.map((s) => [s.productId, s.quantity]));

    return {
      success: true,
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
      },
      products: products.map((p) => ({
        productId: p.id,
        productName: p.name,
        productDescription: p.description,
        unit: p.unit,
        available: qtyByProduct.get(p.id) ?? 0,
        minStock: p.minStock,
      })),
    };
  } catch (error) {
    console.error("Error fetching location products:", error);
    return { success: false, error: "Failed to load products" };
  }
}
