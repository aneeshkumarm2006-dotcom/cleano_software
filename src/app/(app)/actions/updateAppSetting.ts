"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

interface UpdateAppSettingParams {
  key: string;
  category: string;
  value: unknown;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

export async function updateAppSetting(params: UpdateAppSettingParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const { key, category, value } = params;
    if (!key || !category) {
      return { success: false, error: "Key and category are required" };
    }

    await db.appSetting.upsert({
      where: { key },
      create: {
        key,
        category,
        value: value as never,
      },
      update: {
        category,
        value: value as never,
      },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error updating app setting:", error);
    return { success: false, error: "Failed to update setting" };
  }
}

export async function deleteAppSetting(key: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    await db.appSetting.delete({ where: { key } });
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Error deleting app setting:", error);
    return { success: false, error: "Failed to delete setting" };
  }
}
