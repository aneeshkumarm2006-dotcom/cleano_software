"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isStaffRole } from "@/lib/role-routing";
import { actorFromSession } from "@/server/actor";
import { requestRestock } from "@/server/kit/kit";
import { revalidateAfterRestockRequest } from "@/server/kit/revalidate";

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
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" };
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

  const reason = input.jobId
    ? `${input.reason || "Equipment for upcoming job"} (Job: ${input.jobId})`
    : input.reason || "Equipment request";

  // A product: the rules live in server/kit/kit.ts (requestRestock), shared
  // with the phone's POST /api/v1/kit/requests — one PENDING request per
  // cleaner and product, taken under a lock so two taps can't both create one.
  if (input.productId) {
    try {
      const res = await requestRestock(
        actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
        { items: [{ productId: input.productId, quantity: input.quantity }], reason },
      );
      if (!res.ok) return { success: false, error: res.message };
      const [line] = res.value.results;
      const request = await db.inventoryRequest.findFirst({ where: { id: line.request.id } });
      if (line.outcome === "ALREADY_PENDING") {
        return { success: true, request, alreadyPending: true };
      }
      revalidateAfterRestockRequest();
      return { success: true, request };
    } catch (error) {
      console.error("Error creating inventory request:", error);
      return { success: false, error: "Failed to create equipment request" };
    }
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
        kitId: input.kitId,
      },
    });
    if (existing) {
      return { success: true, request: existing, alreadyPending: true };
    }

    let alertTitle = "Equipment requested";
    let alertMessage = `${session.user.name} requested ${input.quantity}`;
    let relatedId: string | null = null;
    let relatedType: string | null = null;

    // A kit template (a product returned above).
    if (input.kitId) {
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

    const request = await db.inventoryRequest.create({
      data: {
        employeeId: session.user.id,
        productId: null,
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
