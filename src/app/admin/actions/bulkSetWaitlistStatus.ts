"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { WaitlistStatus } from "@prisma/client";

type Result = { success: true; count: number } | { success: false; error: string };

const VALID_STATUSES = Object.values(WaitlistStatus) as WaitlistStatus[];

// Bulk-set Waitlist.status for the selected ids. Gated on staff roles like the
// other admin actions. Validates the target status against the enum. (updateMany)
export async function bulkSetWaitlistStatus(
  ids: string[],
  status: WaitlistStatus
): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  if (!VALID_STATUSES.includes(status)) {
    return { success: false, error: "Invalid status" };
  }

  const cleanIds = Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.waitlist.updateMany({
      where: { id: { in: cleanIds } },
      data: { status },
    });
    revalidatePath("/admin/waitlist");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetWaitlistStatus", e);
    return { success: false, error: "Failed to update selected entries" };
  }
}
