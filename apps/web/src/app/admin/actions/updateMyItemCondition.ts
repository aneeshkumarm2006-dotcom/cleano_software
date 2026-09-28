"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isCleanerRole } from "@/lib/role-routing";
import { isEquipmentCondition, type EquipmentCondition } from "@bookmops/core/inventory";
import { actorFromSession } from "@/server/actor";
import { setKitCondition } from "@/server/kit/kit";
import { revalidateAfterKitChange } from "@/server/kit/revalidate";

/**
 * Cleaner reports the CONDITION of a reusable tool in their own kit
 * (cleano_inventory_operations_fixes.pdf #4, Stage 2 of `_ai_context/TODO.md`).
 *
 * This is the replacement for "Request refill" on equipment rows. A scraper is
 * never low — it is Available, Missing, Damaged, Needs replacement or Needs
 * maintenance — so the action a cleaner is offered for a tool has to be able to
 * say those things, and an admin has to see it without reading a free-text note.
 *
 * NOTHING here moves stock. The three writes (the kit row's condition, the
 * STATUS_REPORT history row, and the de-duplicated review flag) live in
 * server/kit/kit.ts (setKitCondition), shared with the phone's
 * PUT /api/v1/kit/items/:id/condition.
 *
 * AUTHZ: the kit row is keyed by the SESSION user id, never by client input, so
 * a cleaner can only ever report against their own kit.
 */
export async function updateMyItemCondition(input: {
  productId: string;
  condition: EquipmentCondition;
  note?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false as const, error: "Not authenticated" };

  const user = session.user as { id: string; name?: string | null; email: string; role?: string | null };

  // Fail closed — this is the cleaner self-service path. Admin edits go through
  // setCleanerProductQuantity / the flag queue.
  if (!isCleanerRole(user.role)) {
    return { success: false as const, error: "Not authorized" };
  }

  if (typeof input.productId !== "string" || input.productId.length === 0) {
    return { success: false as const, error: "Invalid item" };
  }
  if (!isEquipmentCondition(input.condition)) {
    return { success: false as const, error: "Pick a condition" };
  }

  const res = await setKitCondition(actorFromSession(user), {
    productId: input.productId,
    condition: input.condition,
    note: typeof input.note === "string" ? input.note : null,
    now: new Date(),
  });
  if (!res.ok) return { success: false as const, error: res.message };

  revalidateAfterKitChange();
  return { success: true as const, condition: res.value.condition };
}
