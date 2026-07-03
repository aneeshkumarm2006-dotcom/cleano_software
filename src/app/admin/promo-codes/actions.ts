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

// Bulk actions are gated on staff roles (OWNER / ADMIN / OPS_MANAGER).
async function requireStaff(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true };
}

function sanitizePromoIds(ids: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter((id) => typeof id === "string" && id)));
}

// Bulk activate / deactivate promo codes (PromoCode.isActive).
export async function bulkSetPromoActive(
  ids: string[],
  isActive: boolean
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  const cleanIds = sanitizePromoIds(ids);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.promoCode.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { isActive },
    });
    revalidatePath("/admin/promo-codes");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetPromoActive", e);
    return { success: false, error: "Failed to update selected promo codes" };
  }
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
