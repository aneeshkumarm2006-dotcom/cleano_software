"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") return null;
  return session;
}

export async function createPromoCode(data: {
  code: string;
  description?: string;
  discountType: "FIXED" | "PERCENT";
  discountValue: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}) {
  if (!await requireAdmin()) return { success: false, error: "Unauthorized" };

  if (!data.code?.trim()) return { success: false, error: "Code is required" };
  if (!data.discountValue || data.discountValue <= 0) return { success: false, error: "Discount value must be positive" };

  try {
    await db.promoCode.create({
      data: {
        code: data.code.trim().toUpperCase(),
        description: data.description?.trim() || null,
        discountType: data.discountType,
        discountValue: data.discountValue,
        maxUses: data.maxUses ?? null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
    revalidatePath("/admin/promo-codes");
    return { success: true };
  } catch (e: any) {
    if (e?.code === "P2002") return { success: false, error: "Code already exists" };
    return { success: false, error: "Failed to create" };
  }
}

export async function togglePromoCode(id: string) {
  if (!await requireAdmin()) return { success: false, error: "Unauthorized" };
  const promo = await db.promoCode.findUnique({ where: { id }, select: { isActive: true } });
  if (!promo) return { success: false, error: "Not found" };
  await db.promoCode.update({ where: { id }, data: { isActive: !promo.isActive } });
  revalidatePath("/admin/promo-codes");
  return { success: true };
}

export async function deletePromoCode(id: string) {
  if (!await requireAdmin()) return { success: false, error: "Unauthorized" };
  await db.promoCode.delete({ where: { id } });
  revalidatePath("/admin/promo-codes");
  return { success: true };
}
