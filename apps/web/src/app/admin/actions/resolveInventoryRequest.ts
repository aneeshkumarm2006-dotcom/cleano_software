"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { actorFromSession } from "@/server/actor";
import { resolveKitRequest } from "@/server/manager/kit-requests";

/**
 * Admin approves or rejects a cleaner's equipment/refill request.
 *
 * Approving a PRODUCT request also transfers the quantity from warehouse
 * stock to the cleaner's assigned inventory (and marks it FULFILLED). Kit
 * requests are only marked APPROVED — the admin assigns the kit through the
 * existing kit-assignment flow.
 *
 * Stage 4 (PDF #5): the warehouse side of that transfer goes through
 * `adjustWarehouseStock`, so the location row moves with the count instead of
 * `Product.stockLevel` drifting away from it. The stock the request is judged
 * against is therefore the same number the Requests tab and the Edit Product
 * modal show — which is what unblocks the "Only 0 Buckets in warehouse"
 * screenshot on p.5 while there were 8 on the shelf.
 *
 * ONCE, AND NOT BY THE REQUESTER. Every status change is a conditional update
 * on PENDING, and on the product path it is the first write in the stock
 * transaction, which also makes the warehouse check under a lock on the
 * product (server/manager/kit-requests.ts, shared with the phone). Two admins approving the same request both pass the read
 * above it; only one gets the row, and the other's transaction rolls back
 * before any stock moves. An owner or admin who carries a kit themselves
 * files requests like anyone else, and approving their own is handing
 * themselves warehouse stock, so that is refused.
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
  if (typeof requestId !== "string" || !requestId) {
    return { success: false, error: "Request not found" };
  }

  try {
    // The decision is the shared service (server/manager/kit-requests.ts), the
    // one the phone's approvals run: the self rule, then the claim, the
    // warehouse check and the stock movement in ONE transaction.
    const res = await resolveKitRequest(
      actorFromSession({ ...session.user, role: role ?? null }),
      requestId,
      decision === "APPROVED" ? "APPROVE" : "REJECT",
      "web",
    );
    if (!res.ok) return { success: false, error: res.message };

    revalidatePath(`/admin/employees/${res.value.employee.id}`);
    revalidatePath("/admin/inventory");
    revalidatePath("/cleaners/my-inventory");
    // Manage Stock lives on Settings and reads the location rows this just
    // moved — without this it keeps showing the pre-approval number (Stage 4.5).
    revalidatePath("/admin/settings");

    return { success: true, status: res.value.status };
  } catch (error) {
    console.error("Error resolving inventory request:", error);
    return { success: false, error: "Failed to resolve request" };
  }
}
