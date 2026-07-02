"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { CleanerTier } from "@/lib/pay-tiers";

const VALID_TIERS: CleanerTier[] = ["TRAINEE", "STANDARD", "FIELD_LEAD"];

// Admin manually sets a cleaner's payroll tier. Never changes automatically —
// there is no auto-graduation from Trainee to Standard (spec requirement).
export async function setCleanerTier(
  employeeId: string,
  tier: CleanerTier
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  if (!VALID_TIERS.includes(tier)) {
    return { success: false, error: "Invalid tier" };
  }

  await db.user.update({
    where: { id: employeeId },
    data: { cleanerTier: tier },
  });

  revalidatePath(`/admin/employees/${employeeId}`);
  return { success: true };
}
