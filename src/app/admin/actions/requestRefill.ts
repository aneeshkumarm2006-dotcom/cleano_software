"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface RequestRefillInput {
  productId: string;
  quantity: number;
  reason?: string;
}

export async function requestRefill(input: RequestRefillInput) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  if (input.quantity <= 0) {
    return { success: false, error: "Quantity must be greater than zero" };
  }

  try {
    const product = await db.product.findUnique({
      where: { id: input.productId },
    });

    if (!product) {
      return { success: false, error: "Product not found" };
    }

    const request = await db.inventoryRequest.create({
      data: {
        employeeId: session.user.id,
        productId: input.productId,
        quantity: input.quantity,
        reason: input.reason ?? "Refill requested during clock-out",
        status: "PENDING",
      },
    });

    await db.alert.create({
      data: {
        type: "LOW_INVENTORY",
        severity: "WARNING",
        title: `Refill requested: ${product.name}`,
        message: `${session.user.name} requested ${input.quantity} ${product.unit} of ${product.name}`,
        relatedId: product.id,
        relatedType: "Product",
      },
    });

    revalidatePath("/cleaners/my-jobs");
    revalidatePath("/admin/inventory");

    return { success: true, request };
  } catch (error) {
    console.error("Error requesting refill:", error);
    return { success: false, error: "Failed to request refill" };
  }
}
