"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type {
  LocationStockEntry,
  ProductLocationStock,
} from "./getLocationStock.types";

export async function getLocationStock(
  productIds?: string[]
): Promise<
  | { success: true; products: ProductLocationStock[] }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const locations = await db.inventoryLocation.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    const stockWhere =
      productIds && productIds.length > 0
        ? { productId: { in: productIds } }
        : {};

    const stocks = await db.inventoryLocationStock.findMany({
      where: stockWhere,
      include: {
        product: true,
        location: true,
      },
    });

    const productMap = new Map<string, ProductLocationStock>();

    for (const stock of stocks) {
      if (!stock.location.isActive) continue;

      const existing = productMap.get(stock.productId);
      const entry: LocationStockEntry = {
        locationId: stock.locationId,
        locationName: stock.location.name,
        locationAddress: stock.location.address,
        quantity: stock.quantity,
      };

      if (existing) {
        existing.locations.push(entry);
        existing.totalAcrossLocations += stock.quantity;
      } else {
        productMap.set(stock.productId, {
          productId: stock.productId,
          productName: stock.product.name,
          unit: stock.product.unit,
          totalAcrossLocations: stock.quantity,
          locations: [entry],
        });
      }
    }

    if (productIds && productIds.length > 0) {
      const missingProducts = productIds.filter((id) => !productMap.has(id));
      if (missingProducts.length > 0) {
        const products = await db.product.findMany({
          where: { id: { in: missingProducts } },
        });
        for (const p of products) {
          productMap.set(p.id, {
            productId: p.id,
            productName: p.name,
            unit: p.unit,
            totalAcrossLocations: 0,
            locations: locations.map((loc) => ({
              locationId: loc.id,
              locationName: loc.name,
              locationAddress: loc.address,
              quantity: 0,
            })),
          });
        }
      }
    }

    for (const product of productMap.values()) {
      const presentLocationIds = new Set(
        product.locations.map((l) => l.locationId)
      );
      for (const loc of locations) {
        if (!presentLocationIds.has(loc.id)) {
          product.locations.push({
            locationId: loc.id,
            locationName: loc.name,
            locationAddress: loc.address,
            quantity: 0,
          });
        }
      }
      product.locations.sort((a, b) =>
        a.locationName.localeCompare(b.locationName)
      );
    }

    return {
      success: true,
      products: Array.from(productMap.values()).sort((a, b) =>
        a.productName.localeCompare(b.productName)
      ),
    };
  } catch (error) {
    console.error("Error fetching location stock:", error);
    return { success: false, error: "Failed to load location stock" };
  }
}
