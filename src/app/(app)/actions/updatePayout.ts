"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

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

    const finalAmount = baseAmount + adjustments - deductions + reimbursements;

    await db.payout.update({
      where: { id },
      data: {
        baseAmount,
        adjustments,
        deductions,
        reimbursements,
        finalAmount: Number(finalAmount.toFixed(2)),
        notes,
      },
    });

    revalidatePath("/payouts");
    revalidatePath(`/payouts/${payout.payPeriodId}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating payout:", error);
    return { error: "Failed to update payout" };
  }
}
