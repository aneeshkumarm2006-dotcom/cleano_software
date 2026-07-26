"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

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

    const insufficient = kit.items.filter(
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

    await db.$transaction(async (tx) => {
      for (const item of kit.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stockLevel: { decrement: item.quantity } },
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

        // Audit rows — kit assignments were moving stock with no trace, so they
        // were invisible in both the activity log and the product's Stock
        // History (fix list item 18). One row for the cleaner's kit, one for
        // the warehouse, matching every other assignment path.
        const before = existing?.quantity ?? 0;
        await tx.inventoryChange.createMany({
          data: [
            {
              productId: item.productId,
              employeeId,
              employeeName: employee.name ?? null,
              quantityChange: item.quantity,
              newQuantity: before + item.quantity,
              unit: item.product.unit,
              reason: `Assigned via kit: ${kit.name}`,
              changedById: actorId,
              changedByName: actorName,
            },
            {
              productId: item.productId,
              employeeId: null,
              employeeName: null,
              quantityChange: -item.quantity,
              newQuantity: item.product.stockLevel - item.quantity,
              unit: item.product.unit,
              reason: `Kit "${kit.name}" issued to ${employee.name ?? "cleaner"}`,
              changedById: actorId,
              changedByName: actorName,
            },
          ],
        });
      }
    });

    revalidatePath(`/admin/employees/${employeeId}`);
    revalidatePath("/admin/inventory");
    return { success: true };
  } catch (error) {
    console.error("Error assigning kit:", error);
    return { success: false, error: "Failed to assign kit" };
  }
}
