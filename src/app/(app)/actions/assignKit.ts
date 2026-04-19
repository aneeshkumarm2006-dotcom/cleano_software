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
      }
    });

    revalidatePath(`/employees/${employeeId}`);
    revalidatePath("/inventory");
    return { success: true };
  } catch (error) {
    console.error("Error assigning kit:", error);
    return { success: false, error: "Failed to assign kit" };
  }
}
