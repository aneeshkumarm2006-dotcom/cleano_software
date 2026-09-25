"use server";

// A cleaner's usual $/hr (Sept 17 list, item 22: "hourly rate should default
// from the cleaner employee profile or pay tier/rating").
//
// This figure is a DEFAULT and nothing more. It seeds the per-cleaner rate when
// that cleaner is assigned to a new hourly job, and no pay calculation ever
// reads it. That is deliberate: if pay were computed from the profile, giving
// someone a raise today would silently change what they are owed for work
// already scheduled, and for hourly work already done but not yet paid.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { logActivity } from "@/lib/activity-log";

const MAX_HOURLY_RATE = 1000;

export async function setCleanerDefaultHourlyRate(
  employeeId: string,
  rate: number | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }
  if (typeof employeeId !== "string" || !employeeId) {
    return { success: false, error: "Invalid request" };
  }

  let value: number | null = null;
  if (rate !== null && rate !== undefined && String(rate) !== "") {
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_HOURLY_RATE) {
      return { success: false, error: `Enter a rate between $0.01 and $${MAX_HOURLY_RATE}.` };
    }
    value = Math.round(n * 100) / 100;
  }

  try {
    const res = await db.user.updateMany({
      where: { id: employeeId, role: { not: "CLIENT" } },
      data: { defaultHourlyRate: value },
    });
    if (res.count === 0) return { success: false, error: "Cleaner not found" };

    await logActivity({
      category: "ADMIN",
      action: "employee.default_hourly_rate.set",
      status: "SUCCESS",
      targetType: "User",
      targetId: employeeId,
      message:
        value === null
          ? "Cleared a cleaner's default hourly rate. New hourly jobs will use the job's own rate."
          : `Set a cleaner's default hourly rate to $${value.toFixed(2)}/h. It seeds new hourly jobs only; existing jobs are unchanged.`,
    }).catch(() => {});

    revalidatePath(`/admin/employees/${employeeId}`);
    return { success: true };
  } catch (e) {
    console.error("setCleanerDefaultHourlyRate", e);
    return { success: false, error: "Couldn't save that rate. Nothing was changed." };
  }
}
