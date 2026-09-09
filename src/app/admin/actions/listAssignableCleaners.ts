"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * The people who can be put on a job, for a compact picker.
 *
 * Names and ids only. The full team objects the job page loads carry pay
 * tiers, emails and availability, none of which a dropdown needs — and a
 * side panel that has to fetch all that before it can open is a side panel
 * nobody uses.
 */
export async function listAssignableCleaners(): Promise<
  | { success: true; cleaners: { id: string; name: string; role: string }[] }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const cleaners = await db.user.findMany({
    where: {
      role: { in: ["EMPLOYEE", "FIELD_LEAD"] },
      deletedAt: null,
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return { success: true, cleaners };
}
