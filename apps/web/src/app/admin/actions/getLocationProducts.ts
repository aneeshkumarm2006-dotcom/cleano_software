"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { LocationProductEntry } from "./getLocationProducts.types";
import { isStaffRole } from "@/lib/role-routing";
import { locationProducts } from "@/server/kit/kit";

/**
 * EVERY active product at a location, with what it has on record. Hiding
 * out-of-stock items was a hard block by omission: a cleaner could not pick up
 * something that had been restocked outside the app, and had no way to record
 * that they took it (fix list items 5 + 19). The read is server/kit/kit.ts
 * (locationProducts), shared with the phone's
 * GET /api/v1/kit/locations/:id/products.
 */
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
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" };
  }

  if (!locationId) {
    return { success: false, error: "Location is required" };
  }

  try {
    const res = await locationProducts(locationId);
    if (!res.ok) return { success: false, error: "Location not found" };
    return {
      success: true,
      location: res.value.location,
      products: res.value.items.map((p) => ({
        productId: p.productId,
        productName: p.name,
        productDescription: p.description,
        unit: p.unit,
        available: p.available,
        minStock: p.minStock,
      })),
    };
  } catch (error) {
    console.error("Error fetching location products:", error);
    return { success: false, error: "Failed to load products" };
  }
}
