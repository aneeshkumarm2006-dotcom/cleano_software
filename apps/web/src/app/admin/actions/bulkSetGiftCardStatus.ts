"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

async function requireStaff(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true };
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
}

// Every GiftCardStatus enum value (see prisma/schema.prisma). Admins may bulk-set
// the selected (non-deleted) gift cards to a validated value — the UI exposes
// Activate (ACTIVE) and Deactivate (CANCELLED).
const ALLOWED_STATUSES = [
  "PENDING_PAYMENT",
  "ACTIVE",
  "REDEEMED",
  "REFUNDED",
  "CANCELLED",
] as const;
type BulkGiftCardStatus = (typeof ALLOWED_STATUSES)[number];

// Bulk-set the status of the selected (non-deleted) gift cards to a validated value.
export async function bulkSetGiftCardStatus(
  ids: string[],
  status: string
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  if (!ALLOWED_STATUSES.includes(status as BulkGiftCardStatus)) {
    return { success: false, error: "Invalid status" };
  }

  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.giftCard.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { status: status as BulkGiftCardStatus },
    });
    revalidatePath("/admin/gift-cards");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetGiftCardStatus", e);
    return { success: false, error: "Failed to update status" };
  }
}
