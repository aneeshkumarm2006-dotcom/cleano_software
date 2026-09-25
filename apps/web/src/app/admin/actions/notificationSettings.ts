"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { seedNotificationCatalog } from "@/lib/notifications";

function isAdminRole(role: string | undefined) {
  return role === "OWNER" || role === "ADMIN" || role === "OPS_MANAGER" || role === "FIELD_LEAD";
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session || !isAdminRole(role)) return false;
  return true;
}

export async function toggleNotificationSetting(
  id: string,
  enabled: boolean
): Promise<{ success: true } | { success: false; error: string }> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized" };
  try {
    await db.notificationSetting.update({
      where: { id },
      data: { enabled },
    });
    revalidatePath("/admin/settings");
    return { success: true };
  } catch (e) {
    console.error("toggleNotificationSetting failed", e);
    return { success: false, error: "Failed to update setting" };
  }
}

export async function bulkSetNotificationCategory(
  recipient: "ADMIN" | "CUSTOMER" | "PROVIDER",
  category: string,
  channel: "EMAIL" | "SMS" | "APP_PUSH",
  enabled: boolean
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized" };
  try {
    const res = await db.notificationSetting.updateMany({
      where: { recipient, category, channel },
      data: { enabled },
    });
    revalidatePath("/admin/settings");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetNotificationCategory failed", e);
    return { success: false, error: "Failed to update settings" };
  }
}

export async function reseedNotificationCatalog(): Promise<
  { success: true; inserted: number; total: number } | { success: false; error: string }
> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized" };
  try {
    const res = await seedNotificationCatalog();
    revalidatePath("/admin/settings");
    return { success: true, ...res };
  } catch (e) {
    console.error("reseedNotificationCatalog failed", e);
    return { success: false, error: "Failed to reseed catalog" };
  }
}
