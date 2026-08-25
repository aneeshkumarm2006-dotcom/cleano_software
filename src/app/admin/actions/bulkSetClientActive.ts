"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";

type Result = { success: true; count: number } | { success: false; error: string };

// Bulk-toggle Client.isActive for the selected ids. Gated on staff roles like the
// other admin actions. Recoverable/idempotent (updateMany).
export async function bulkSetClientActive(ids: string[], isActive: boolean): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const cleanIds = Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.client.updateMany({
      where: { id: { in: cleanIds } },
      data: { isActive },
    });
    revalidatePath("/admin/clients");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetClientActive", e);
    return { success: false, error: "Failed to update selected clients" };
  }
}
