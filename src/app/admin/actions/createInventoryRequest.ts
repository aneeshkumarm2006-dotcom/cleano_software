"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface CreateInventoryRequestInput {
  productId?: string;
  kitId?: string;
  quantity: number;
  reason?: string;
  jobId?: string;
}

export async function createInventoryRequest(
  input: CreateInventoryRequestInput
) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  if (!input.productId && !input.kitId) {
    return {
      success: false,
      error: "Either a product or kit must be specified",
    };
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { success: false, error: "Quantity must be greater than zero" };
  }

  try {
    // Idempotency: one open request per employee + item. Re-requesting while a
    // request is still PENDING returns the existing row instead of creating a
    // duplicate row + duplicate admin alert (the cleaner UI also disables the
    // button, this is the server-side backstop).
    const existing = await db.inventoryRequest.findFirst({
      where: {
        employeeId: session.user.id,
        status: "PENDING",
        ...(input.productId
          ? { productId: input.productId }
          : { kitId: input.kitId }),
      },
    });
    if (existing) {
      return { success: true, request: existing, alreadyPending: true };
    }

    let alertTitle = "Equipment requested";
    let alertMessage = `${session.user.name} requested ${input.quantity}`;
    let relatedId: string | null = null;
    let relatedType: string | null = null;

    if (input.productId) {
      const product = await db.product.findUnique({
        where: { id: input.productId },
      });
      if (!product) {
        return { success: false, error: "Product not found" };
      }
      alertTitle = `Equipment requested: ${product.name}`;
      alertMessage = `${session.user.name} requested ${input.quantity} ${product.unit} of ${product.name}`;
      relatedId = product.id;
      relatedType = "Product";
    } else if (input.kitId) {
      const kit = await db.kitTemplate.findUnique({
        where: { id: input.kitId },
      });
      if (!kit) {
        return { success: false, error: "Kit template not found" };
      }
      alertTitle = `Kit requested: ${kit.name}`;
      alertMessage = `${session.user.name} requested ${input.quantity} ${kit.name} kit(s)`;
      relatedId = kit.id;
      relatedType = "KitTemplate";
    }

    const reason = input.jobId
      ? `${input.reason || "Equipment for upcoming job"} (Job: ${input.jobId})`
      : input.reason || "Equipment request";

    const request = await db.inventoryRequest.create({
      data: {
        employeeId: session.user.id,
        productId: input.productId ?? null,
        kitId: input.kitId ?? null,
        quantity: input.quantity,
        reason,
        status: "PENDING",
      },
    });

    await db.alert.create({
      data: {
        type: "LOW_INVENTORY",
        severity: "WARNING",
        title: alertTitle,
        message: alertMessage,
        relatedId,
        relatedType,
        employeeId: session.user.id,
      },
    });

    revalidatePath("/cleaners/my-inventory");
    revalidatePath("/cleaners/my-inventory/resolve");
    revalidatePath("/admin/inventory");

    return { success: true, request };
  } catch (error) {
    console.error("Error creating inventory request:", error);
    return { success: false, error: "Failed to create equipment request" };
  }
}
