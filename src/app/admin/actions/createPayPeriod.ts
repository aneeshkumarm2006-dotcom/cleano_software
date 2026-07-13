"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import {
  formatPayPeriodRange,
  parseBusinessDate,
  payPeriodRangeFor,
} from "@/lib/pay-period";
import { generatePayPeriodForWeek } from "@/lib/pay-period.server";

/**
 * Create a pay period for ONE Monday–Sunday week (item 2).
 *
 * AUTHZ: ADMIN/OWNER only.
 *
 * Validation:
 *   • dates are parsed as business-timezone calendar days (not UTC midnight);
 *   • the range is snapped to the Mon–Sun week that contains the start date —
 *     a range spanning multiple weeks is rejected rather than silently truncated;
 *   • an overlapping pay period for the same week is rejected (fail closed), so
 *     payroll can't be run twice and double-pay a job.
 *
 * Payout math is shared with My Pay / My Income via computeJobPayShares().
 */
export async function createPayPeriod(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const startDateStr = formData.get("startDate");
  const endDateStr = formData.get("endDate");
  const notesRaw = formData.get("notes");
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim().slice(0, 500)
      : null;

  const submittedStart = parseBusinessDate(startDateStr);
  const submittedEnd = parseBusinessDate(endDateStr);

  if (!submittedStart || !submittedEnd) {
    return { error: "Start and end dates are required (YYYY-MM-DD)" };
  }
  if (submittedEnd < submittedStart) {
    return { error: "End date must be on or after start date" };
  }

  // Snap to the Mon–Sun week that contains the start date.
  const week = payPeriodRangeFor(submittedStart);
  if (submittedEnd > week.end) {
    return {
      error: `Pay periods run Monday–Sunday. That range spans more than one week — use ${formatPayPeriodRange(
        week
      )}.`,
    };
  }

  const startDate = week.start;
  const rangeEnd = week.end;

  try {
    const result = await generatePayPeriodForWeek(week, notes);
    if (!result.success) return { error: result.error };

    revalidatePath("/admin/payouts");
    return {
      success: true,
      payPeriodId: result.payPeriodId,
      periodLabel: result.periodLabel,
    };
  } catch (error) {
    console.error("Error creating pay period:", error);
    return { error: "Failed to create pay period" };
  }
}
