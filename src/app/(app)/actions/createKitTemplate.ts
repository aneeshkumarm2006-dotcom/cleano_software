"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface KitItemInput {
  productId: string;
  quantity: number;
}

interface CreateKitTemplateParams {
  name: string;
  description?: string | null;
  isActive?: boolean;
  items: KitItemInput[];
}

export async function createKitTemplate(params: CreateKitTemplateParams) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };
    const role = (session.user as { role?: string }).role;
    if (role !== "OWNER" && role !== "ADMIN") {
      return { success: false, error: "Not authorized" };
    }

    const { name, description, isActive = true, items } = params;
    if (!name?.trim()) {
      return { success: false, error: "Kit name is required" };
    }

    const filtered = (items || []).filter(
      (it) => it.productId && it.quantity > 0
    );

    const kit = await db.kitTemplate.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        isActive,
        items: {
          create: filtered.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
          })),
        },
      },
    });

    revalidatePath("/settings");
    return { success: true, kitId: kit.id };
  } catch (error) {
    console.error("Error creating kit template:", error);
    return { success: false, error: "Failed to create kit template" };
  }
}
