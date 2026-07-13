"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  type NotificationPrefs,
  defaultPrefsForRole,
} from "./notificationPrefsConstants";

const KEY_PREFIX = "notifications.prefs.";

/**
 * Defaults depend on the TARGET user's role (cleaners are opted in to
 * job-critical notifications only; admins keep ops alerting on), so we resolve
 * the role from the DB rather than trusting the caller's session role.
 */
async function targetDefaults(targetId: string): Promise<NotificationPrefs> {
  const user = await db.user.findUnique({
    where: { id: targetId },
    select: { role: true },
  });
  return defaultPrefsForRole(user?.role);
}

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

    // IDOR guard: only an admin may read someone else's preferences.
    if (!isAdmin && targetId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    const [setting, defaults] = await Promise.all([
      db.appSetting.findUnique({ where: { key: KEY_PREFIX + targetId } }),
      targetDefaults(targetId),
    ]);

    if (!setting) {
      return { success: true, prefs: defaults };
    }

    const stored = setting.value as Partial<NotificationPrefs>;
    return {
      success: true,
      prefs: { ...defaults, ...stored },
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

    // IDOR guard: only an admin may write someone else's preferences.
    if (!isAdmin && targetId !== session.user.id) {
      return { success: false, error: "Not authorized" };
    }

    // Allow-list the incoming payload: unknown keys are dropped and every value
    // is coerced to a real boolean, so a hand-rolled request can't stash
    // arbitrary JSON in the AppSetting row.
    const defaults = await targetDefaults(targetId);
    const merged: NotificationPrefs = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof NotificationPrefs)[]) {
      const value = input.prefs?.[key];
      if (typeof value === "boolean") merged[key] = value;
    }

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
