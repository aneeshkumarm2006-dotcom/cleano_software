"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { adjustWarehouseStock, pickSourceLocationId } from "@/lib/stock.server";

interface AssignKitParams {
  employeeId: string;
  kitTemplateId: string;
}

export async function assignKit(params: AssignKitParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const { employeeId, kitTemplateId } = params;
    if (!employeeId || !kitTemplateId) {
      return { success: false, error: "Employee and kit template are required" };
    }

    const actorId = session.user.id;
    const actorName = session.user.name ?? null;

    const kit = await db.kitTemplate.findUnique({
      where: { id: kitTemplateId },
      include: { items: { include: { product: true } } },
    });
    if (!kit) return { success: false, error: "Kit template not found" };
    if (!kit.isActive) {
      return { success: false, error: "Kit template is inactive" };
    }
    if (kit.items.length === 0) {
      return { success: false, error: "Kit template has no products" };
    }

    const employee = await db.user.findUnique({ where: { id: employeeId } });
    if (!employee) return { success: false, error: "Employee not found" };

    // Issuing a kit is an ASSIGNMENT, so an archived product in the template
    // must not go out (Stage 5) — this path is how kit rows end up pointing at
    // products no picker will ever show again, which is what produced the p.6
    // "Product not found.".
    //
    // SKIPPED, not refused. Archiving a product IS the statement "we don't
    // stock this any more", so a starter kit should stop handing it out — but
    // it should not become un-issuable because of it. (The live "Default
    // Starting Kit" has nine archived lines; refusing would have killed the
    // whole flow.) What must not happen is skipping SILENTLY, so the names come
    // back to the caller.
    const issuable = kit.items.filter((it) => it.product.deletedAt === null);
    const skipped = kit.items
      .filter((it) => it.product.deletedAt !== null)
      .map((it) => it.product.name);

    if (issuable.length === 0) {
      return {
        success: false,
        error: `Every product in "${kit.name}" has been archived, so there is nothing to issue. Restore them from Inventory → Archived, or update the kit.`,
      };
    }

    const insufficient = issuable.filter(
      (it) => it.product.stockLevel < it.quantity
    );
    if (insufficient.length > 0) {
      return {
        success: false,
        error: `Insufficient warehouse stock: ${insufficient
          .map((i) => `${i.product.name} (need ${i.quantity}, have ${i.product.stockLevel})`)
          .join(", ")}`,
      };
    }

    await db.$transaction(
      async (tx) => {
        for (const item of issuable) {
          // Stage 4: the warehouse side goes through the one helper allowed to
          // touch it, so issuing a kit moves the location row and the count
          // together. This action used to decrement `stockLevel` alone, which is
          // one of the three writers that made the p.5 numbers disagree.
          const locationId = await pickSourceLocationId(
            tx,
            item.productId,
            item.quantity
          );
          await adjustWarehouseStock(tx, {
            productId: item.productId,
            locationId,
            delta: -item.quantity,
            action: "ASSIGN",
            unit: item.product.unit,
            reason: `Kit "${kit.name}" issued to ${employee.name ?? "cleaner"}`,
            actor: { id: actorId, name: actorName },
          });

          const existing = await tx.employeeProduct.findUnique({
            where: {
              employeeId_productId: {
                employeeId,
                productId: item.productId,
              },
            },
          });

          if (existing) {
            await tx.employeeProduct.update({
              where: { id: existing.id },
              data: { quantity: { increment: item.quantity } },
            });
          } else {
            await tx.employeeProduct.create({
              data: {
                employeeId,
                productId: item.productId,
                quantity: item.quantity,
                notes: `Assigned via kit: ${kit.name}`,
              },
            });
          }

          // Audit row — kit assignments were moving stock with no trace, so they
          // were invisible in both the activity log and the product's Stock
          // History (fix list item 18). This is the cleaner's side; the warehouse
          // row is written by `adjustWarehouseStock` above, which is the only
          // thing that knows the post-move total across every location.
          const before = existing?.quantity ?? 0;
          await tx.inventoryChange.create({
            data: {
              productId: item.productId,
              employeeId,
              employeeName: employee.name ?? null,
              quantityChange: item.quantity,
              newQuantity: before + item.quantity,
              unit: item.product.unit,
              action: "ASSIGN",
              reason: `Assigned via kit: ${kit.name}`,
              changedById: actorId,
              changedByName: actorName,
            },
          });
        }
      },
      // Each kit line now runs several sequential queries (source location,
      // stock move, recompute, audit); Supabase round-trips make the default
      // 5s window easy to blow past on a big kit.
      { maxWait: 10_000, timeout: 30_000 }
    );

    revalidatePath(`/admin/employees/${employeeId}`);
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/settings");
    return { success: true, skipped };
  } catch (error) {
    console.error("Error assigning kit:", error);
    return { success: false, error: "Failed to assign kit" };
  }
}
