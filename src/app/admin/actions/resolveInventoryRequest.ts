"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Admin approves or rejects a cleaner's equipment/refill request.
 *
 * Approving a PRODUCT request also transfers the quantity from warehouse
 * stock to the cleaner's assigned inventory (and marks it FULFILLED). Kit
 * requests are only marked APPROVED — the admin assigns the kit through the
 * existing kit-assignment flow.
 */
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

  try {
    const request = await db.inventoryRequest.findUnique({
      where: { id: requestId },
      include: { product: true },
    });
    if (!request) return { success: false, error: "Request not found" };
    if (request.status !== "PENDING") {
      return { success: false, error: "Request has already been resolved" };
    }

    if (decision === "REJECTED") {
      await db.inventoryRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED" },
      });
    } else if (request.productId && request.product) {
      if (request.product.stockLevel < request.quantity) {
        return {
          success: false,
          error: `Only ${request.product.stockLevel} ${request.product.unit} of ${request.product.name} in stock`,
        };
      }
      await db.$transaction([
        db.inventoryRequest.update({
          where: { id: requestId },
          data: { status: "FULFILLED" },
        }),
        db.product.update({
          where: { id: request.productId },
          data: { stockLevel: { decrement: request.quantity } },
        }),
        db.employeeProduct.upsert({
          where: {
            employeeId_productId: {
              employeeId: request.employeeId,
              productId: request.productId,
            },
          },
          update: { quantity: { increment: request.quantity } },
          create: {
            employeeId: request.employeeId,
            productId: request.productId,
            quantity: request.quantity,
          },
        }),
      ]);
    } else {
      // Kit request — approve only; assignment happens via the kit flow.
      await db.inventoryRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED" },
      });
    }

    revalidatePath(`/admin/employees/${request.employeeId}`);
    revalidatePath("/admin/inventory");
    revalidatePath("/cleaners/my-inventory");

    return {
      success: true,
      status: decision === "REJECTED" ? "REJECTED" : request.productId ? "FULFILLED" : "APPROVED",
    };
  } catch (error) {
    console.error("Error resolving inventory request:", error);
    return { success: false, error: "Failed to resolve request" };
  }
}
