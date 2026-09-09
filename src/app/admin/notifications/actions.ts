"use server";

import { revalidatePath } from "next/cache";

import { requireOwnerAdmin } from "@/lib/action-guards";
import { markAdminNotificationsRead } from "@/lib/admin-notifications";

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
