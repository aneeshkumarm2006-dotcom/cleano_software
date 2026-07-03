"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { LifecycleStage } from "@prisma/client";

type Result = { success: true; count: number } | { success: false; error: string };

const VALID_STAGES = new Set<string>(Object.values(LifecycleStage));

// Bulk-set Contact.lifecycle for the selected ids. Gated on staff roles like the
// other admin actions. Validates the stage against the LifecycleStage enum.
export async function bulkSetContactLifecycle(ids: string[], stage: LifecycleStage): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  if (!VALID_STAGES.has(stage)) return { success: false, error: "Invalid lifecycle stage" };

  const cleanIds = Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const res = await db.contact.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { lifecycle: stage },
    });
    revalidatePath("/admin/contacts");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetContactLifecycle", e);
    return { success: false, error: "Failed to update selected contacts" };
  }
}
