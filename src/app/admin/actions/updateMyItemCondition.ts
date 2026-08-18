"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isCleanerRole } from "@/lib/role-routing";
import {
  EQUIPMENT_CONDITION_LABEL,
  conditionFlagType,
  isEquipmentCondition,
  type EquipmentCondition,
} from "@/lib/inventory-status";

/**
 * Cleaner reports the CONDITION of a reusable tool in their own kit
 * (cleano_inventory_operations_fixes.pdf #4, Stage 2 of `_ai_context/TODO.md`).
 *
 * This is the replacement for "Request refill" on equipment rows. A scraper is
 * never low — it is Available, Missing, Damaged, Needs replacement or Needs
 * maintenance — so the action a cleaner is offered for a tool has to be able to
 * say those things, and an admin has to see it without reading a free-text note.
 *
 * NOTHING here moves stock. No quantity changes, no warehouse write-off: a
 * condition is an observation, and the decisions that follow from it (replace
 * it, service it, write it off) belong to an admin working the flag queue.
 *
 * Three writes, one transaction:
 *   1. `EmployeeProduct` — latest condition + when + the cleaner's note.
 *   2. `InventoryChange` — history, carrying previous → new status. PDF #1 wants
 *      exactly this list: cleaner, item, previous status, new status, timestamp.
 *   3. `InventoryFlag`   — an OPEN admin review flag when the new condition is
 *      not AVAILABLE; the matching OPEN flags are RESOLVED when it is.
 *
 * AUTHZ: the kit row is keyed by the SESSION user id, never by client input, so
 * a cleaner can only ever report against their own kit.
 */

const MAX_NOTE_LEN = 300;

export async function updateMyItemCondition(input: {
  productId: string;
  condition: EquipmentCondition;
  note?: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false as const, error: "Not authenticated" };

  const actor = session.user as { id: string; name?: string; role?: string };

  // Fail closed — this is the cleaner self-service path. Admin edits go through
  // setCleanerProductQuantity / the flag queue.
  if (!isCleanerRole(actor.role)) {
    return { success: false as const, error: "Not authorized" };
  }

  if (typeof input.productId !== "string" || input.productId.length === 0) {
    return { success: false as const, error: "Invalid item" };
  }
  if (!isEquipmentCondition(input.condition)) {
    return { success: false as const, error: "Pick a condition" };
  }

  const note = input.note?.trim().slice(0, MAX_NOTE_LEN) || null;

  const kit = await db.employeeProduct.findUnique({
    where: {
      employeeId_productId: {
        employeeId: actor.id,
        productId: input.productId,
      },
    },
    include: {
      product: { select: { name: true, unit: true, itemType: true } },
    },
  });
  if (!kit) {
    return { success: false as const, error: "This item is not in your kit" };
  }

  // Guard the vocabulary, not just the value: a liquid has a LEVEL, not a
  // condition, and letting a mismatched status onto the row would put the
  // wrong word in front of the admin reading it.
  if (kit.product.itemType !== "REUSABLE_EQUIPMENT") {
    return {
      success: false as const,
      error: "Condition reporting only applies to reusable equipment",
    };
  }

  const previous = kit.condition ?? null;
  const next = input.condition;
  const flagType = conditionFlagType(next);
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.employeeProduct.update({
      where: { id: kit.id },
      data: {
        condition: next,
        statusUpdatedAt: now,
        statusNotes: note,
      },
    });

    // quantityChange 0 / newQuantity unchanged: this row records a STATUS
    // transition, not a movement. The count columns still have to be filled —
    // they are non-null — and saying "nothing moved" is the honest value.
    await tx.inventoryChange.create({
      data: {
        productId: kit.productId,
        employeeId: actor.id,
        employeeName: actor.name ?? null,
        quantityChange: 0,
        newQuantity: kit.quantity,
        unit: kit.product.unit,
        action: "STATUS_REPORT",
        previousStatus: previous,
        newStatus: next,
        reason:
          `Condition reported by cleaner: ` +
          `${previous ? `${EQUIPMENT_CONDITION_LABEL[previous]} → ` : ""}` +
          `${EQUIPMENT_CONDITION_LABEL[next]}` +
          (note ? ` — ${note}` : ""),
        changedById: actor.id,
        changedByName: actor.name ?? null,
      },
    });

    if (flagType) {
      // De-dupe: one OPEN flag per (cleaner, product, type). A cleaner tapping
      // "Damaged" twice must not put two identical rows in front of an admin —
      // that is how the Requests tab ended up with 48 pending duplicates
      // (see images/page-05-img-1.png).
      const existing = await tx.inventoryFlag.findFirst({
        where: {
          employeeId: actor.id,
          productId: kit.productId,
          type: flagType,
          status: "OPEN",
        },
        select: { id: true },
      });
      if (existing) {
        await tx.inventoryFlag.update({
          where: { id: existing.id },
          data: { notes: note },
        });
      } else {
        await tx.inventoryFlag.create({
          data: {
            type: flagType,
            employeeId: actor.id,
            productId: kit.productId,
            source: "RECOUNT",
            notes: note,
          },
        });
      }
    }

    // Reported as fine again → close whatever was open against it. Without
    // this the queue only ever grows, and an admin can't tell a live problem
    // from one the cleaner already sorted out.
    await tx.inventoryFlag.updateMany({
      where: {
        employeeId: actor.id,
        productId: kit.productId,
        status: "OPEN",
        ...(flagType ? { type: { not: flagType } } : {}),
      },
      data: { status: "RESOLVED", resolvedAt: now, resolvedById: actor.id },
    });
  });

  revalidatePath("/cleaners/my-inventory");
  revalidatePath("/admin/inventory");
  return { success: true as const, condition: next };
}
