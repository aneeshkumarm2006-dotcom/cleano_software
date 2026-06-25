"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  type NotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
} from "./notificationPrefsConstants";

const KEY_PREFIX = "notifications.prefs.";

export async function getNotificationPrefs(employeeId?: string): Promise<
  | { success: true; prefs: NotificationPrefs }
  | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const targetId = employeeId || session.user.id;

    if (!isAdmin && targetId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    const setting = await db.appSetting.findUnique({
      where: { key: KEY_PREFIX + targetId },
    });

    if (!setting) {
      return { success: true, prefs: DEFAULT_NOTIFICATION_PREFS };
    }

    const stored = setting.value as Partial<NotificationPrefs>;
    return {
      success: true,
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, ...stored },
    };
  } catch (error) {
    console.error("Error getting notification preferences:", error);
    return { success: false, error: "Failed to load preferences" };
  }
}

export async function updateNotificationPrefs(input: {
  employeeId?: string;
  prefs: Partial<NotificationPrefs>;
}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const targetId = input.employeeId || session.user.id;

    if (!isAdmin && targetId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    const merged: NotificationPrefs = {
      ...DEFAULT_NOTIFICATION_PREFS,
      ...input.prefs,
    };

    const key = KEY_PREFIX + targetId;
    await db.appSetting.upsert({
      where: { key },
      create: {
        key,
        category: "notifications",
        value: merged as never,
      },
      update: {
        category: "notifications",
        value: merged as never,
      },
    });

    revalidatePath("/admin/settings");
    return { success: true, prefs: merged };
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    return { success: false, error: "Failed to save preferences" };
  }
}
