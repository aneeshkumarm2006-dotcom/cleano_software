"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { multiplierForRating } from "@/lib/pay-multiplier";
import { getRatingMultiplierMap } from "@/lib/pay-multiplier-config";

interface RecalculateInput {
  employeeId?: string;
}

export async function recalculateMultiplier(input: RecalculateInput = {}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return { success: false, error: "Not authenticated" };
    }

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";
    if (!isAdmin) {
      return { success: false, error: "Not authorized" };
    }
    const targetEmployeeId = input.employeeId || session.user.id;

    const employee = await db.user.findUnique({
      where: { id: targetEmployeeId },
    });
    if (!employee) {
      return { success: false, error: "Employee not found" };
    }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const ratings = await db.employeeRating.findMany({
      where: {
        employeeId: targetEmployeeId,
        createdAt: { gte: since },
      },
      select: { rating: true },
    });

    if (ratings.length === 0) {
      return {
        success: true,
        averageRating: null,
        oldMultiplier: employee.payMultiplier,
        newMultiplier: employee.payMultiplier,
        tierLabel: null,
        changed: false,
        ratingCount: 0,
      };
    }

    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    const avg = sum / ratings.length;
    const ratingMap = await getRatingMultiplierMap();
    const { multiplier, label } = multiplierForRating(avg, ratingMap);

    const oldMultiplier = employee.payMultiplier;
    const changed = Math.abs(oldMultiplier - multiplier) > 0.001;

    if (changed) {
      await db.user.update({
        where: { id: targetEmployeeId },
        data: { payMultiplier: multiplier },
      });

      await db.alert.create({
        data: {
          type: "GENERAL",
          severity: "INFO",
          title: "Pay multiplier updated",
          message: `${employee.name}'s pay multiplier moved from ${oldMultiplier.toFixed(2)}x to ${multiplier.toFixed(2)}x (${label} tier, 30-day avg ${avg.toFixed(2)})`,
          relatedId: targetEmployeeId,
          relatedType: "User",
        },
      });

      revalidatePath("/admin/settings");
      revalidatePath(`/admin/employees/${targetEmployeeId}`);
    }

    return {
      success: true,
      averageRating: avg,
      oldMultiplier,
      newMultiplier: multiplier,
      tierLabel: label,
      changed,
      ratingCount: ratings.length,
    };
  } catch (error) {
    console.error("Error recalculating multiplier:", error);
    return { success: false, error: "Failed to recalculate multiplier" };
  }
}
