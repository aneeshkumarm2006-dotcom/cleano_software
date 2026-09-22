"use server";

import { revalidatePath } from "next/cache";

import { requireOwnerAdmin } from "@/lib/action-guards";
import {
  dismissAdminNotification,
  markAdminNotificationsRead,
  markAllAdminNotificationsRead,
  restoreAdminNotification,
} from "@/lib/admin-notifications";

/** Mark notifications seen by the person looking at them. */
export async function markNotificationsRead(
  ids: string[],
): Promise<{ ok: boolean; marked: number }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, marked: 0 };
  const marked = await markAdminNotificationsRead(guard.userId, ids);
  // The sidebar badge reads the same count, so it has to be told.
  revalidatePath("/admin", "layout");
  return { ok: true, marked };
}

/**
 * Clear the badge, including the notifications the page never listed.
 *
 * The feed shows the newest 50; marking only those could never empty a count of
 * 200 (Sept 10, item 4).
 */
export async function markAllNotificationsRead(): Promise<{
  ok: boolean;
  marked: number;
}> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, marked: 0 };
  const marked = await markAllAdminNotificationsRead(guard.userId);
  revalidatePath("/admin", "layout");
  return { ok: true, marked };
}

/**
 * Archive one notification for the person looking at it (Sept 10, item 13).
 *
 * Archiving is per-person and reversible: the row is kept, so the Archived view
 * can still show it and `restoreNotification` can put it back.
 */
export async function dismissNotification(
  id: string
): Promise<{ ok: boolean }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false };
  const ok = await dismissAdminNotification(guard.userId, id);
  revalidatePath("/admin", "layout");
  return { ok };
}

/** Put an archived notification back in the feed. */
export async function restoreNotification(
  id: string
): Promise<{ ok: boolean }> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false };
  const ok = await restoreAdminNotification(guard.userId, id);
  revalidatePath("/admin", "layout");
  return { ok };
}
