"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setEmployeeRating(
  employeeId: string,
  rating: number
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as any).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const clamped = Math.round(Math.min(5, Math.max(4, rating)) * 10) / 10;

  await db.employeeRating.create({
    data: {
      employeeId,
      rating: clamped,
      ratedBy: session.user.id,
      notes: "Admin manual override",
    },
  });

  revalidatePath(`/admin/employees/${employeeId}`);
  return { success: true };
}

export async function getEmployeeAvgRating(employeeId: string): Promise<number | null> {
  const ratings = await db.employeeRating.findMany({
    where: { employeeId },
    select: { rating: true },
    orderBy: { createdAt: "desc" },
  });

  if (ratings.length === 0) return null;

  const avg = ratings.reduce((s, r) => s + r.rating, 0) / ratings.length;
  // Clamp to 4.0–5.0 range and round to nearest tenth
  return Math.round(Math.min(5, Math.max(4, avg)) * 10) / 10;
}
