"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { CheckoutHistoryEntry } from "./getCheckoutHistory.types";

interface GetCheckoutHistoryInput {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getCheckoutHistory(
  input: GetCheckoutHistoryInput = {}
): Promise<
  | { success: true; checkouts: CheckoutHistoryEntry[] }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const where: {
      employeeId: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = {
      employeeId: session.user.id,
    };

    if (input.startDate || input.endDate) {
      where.createdAt = {};
      if (input.startDate) {
        where.createdAt.gte = new Date(input.startDate);
      }
      if (input.endDate) {
        const end = new Date(input.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const checkouts = await db.inventoryCheckout.findMany({
      where,
      include: {
        location: true,
        items: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 100,
    });

    return {
      success: true,
      checkouts: checkouts.map((c) => ({
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        notes: c.notes,
        location: {
          id: c.location.id,
          name: c.location.name,
          address: c.location.address,
        },
        items: c.items.map((i) => ({
          productId: i.productId,
          productName: i.product.name,
          unit: i.product.unit,
          quantity: i.quantity,
        })),
      })),
    };
  } catch (error) {
    console.error("Error fetching checkout history:", error);
    return { success: false, error: "Failed to load checkout history" };
  }
}
