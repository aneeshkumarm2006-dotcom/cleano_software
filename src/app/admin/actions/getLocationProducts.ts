"use server";

import { db } from "@/db";
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

    const stocks = await db.inventoryLocationStock.findMany({
      where: { locationId, quantity: { gt: 0 } },
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    });

    return {
      success: true,
      location: {
        id: location.id,
        name: location.name,
        address: location.address,
      },
      products: stocks.map((s) => ({
        productId: s.productId,
        productName: s.product.name,
        productDescription: s.product.description,
        unit: s.product.unit,
        available: s.quantity,
      })),
    };
  } catch (error) {
    console.error("Error fetching location products:", error);
    return { success: false, error: "Failed to load products" };
  }
}
