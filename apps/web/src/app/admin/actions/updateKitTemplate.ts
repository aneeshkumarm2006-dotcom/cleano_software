"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";

interface KitItemInput {
  productId: string;
  quantity: number;
}

interface UpdateKitTemplateParams {
  id: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  items: KitItemInput[];
}

export async function updateKitTemplate(params: UpdateKitTemplateParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const { id, name, description, isActive = true, items } = params;
    if (!id || !name?.trim()) {
      return { success: false, error: "Kit id and name are required" };
    }

    const filtered = (items || []).filter(
      (it) => it.productId && it.quantity > 0
    );

    await db.$transaction(async (tx) => {
      const __t0 = await tx.kitTemplate.update({
          where: { id },
          data: {
            name: name.trim(),
            description: description?.trim() || null,
            isActive,
          },
        });
      const __t1 = await tx.kitTemplateItem.deleteMany({ where: { kitTemplateId: id } });
      const __t2 = await tx.kitTemplateItem.createMany({
          data: filtered.map((it) => ({
            kitTemplateId: id,
            productId: it.productId,
            quantity: it.quantity,
          })),
        });
      return [__t0, __t1, __t2];
    });

    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating kit template:", error);
    return { success: false, error: "Failed to update kit template" };
  }
}
