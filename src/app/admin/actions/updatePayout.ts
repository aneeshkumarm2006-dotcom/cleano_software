"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { computePayoutTotals } from "@/lib/payout-math";

function parseFloatSafe(v: FormDataEntryValue | null): number {
  if (v === null || v === "") return 0;
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

export async function updatePayout(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  const id = formData.get("id") as string;
  if (!id) return { error: "Payout id is required" };

  try {
    const payout = await db.payout.findUnique({
      where: { id },
      include: { payPeriod: true },
    });
    if (!payout) return { error: "Payout not found" };
    if (payout.payPeriod.status === "PAID") {
      return { error: "Cannot edit a paid payout" };
    }

    const baseAmount = parseFloatSafe(formData.get("baseAmount"));
    const adjustments = parseFloatSafe(formData.get("adjustments"));
    const deductions = parseFloatSafe(formData.get("deductions"));
    const reimbursements = parseFloatSafe(formData.get("reimbursements"));
    const notes = (formData.get("notes") as string) || null;

    // Floored at $0 — payroll pays out, it never claws back. Any un-recovered
    // deduction is reported to the caller as `shortfall` for admin review
    // rather than being stored as a negative payout (fix list item 1).
    const totals = computePayoutTotals({
      baseAmount,
      adjustments,
      deductions,
      reimbursements,
    });

    await db.payout.update({
      where: { id },
      data: {
        baseAmount,
        adjustments,
        deductions,
        reimbursements,
        finalAmount: totals.final,
        notes,
      },
    });

    revalidatePath("/admin/payouts");
    revalidatePath(`/admin/payouts/${payout.payPeriodId}`);
    return { success: true, shortfall: totals.shortfall };
  } catch (error) {
    console.error("Error updating payout:", error);
    return { error: "Failed to update payout" };
  }
}
