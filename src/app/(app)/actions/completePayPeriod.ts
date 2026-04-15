"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function completePayPeriod(payPeriodId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { error: "Forbidden" };
  }

  if (!payPeriodId) return { error: "Pay period id is required" };

  try {
    const period = await db.payPeriod.findUnique({
      where: { id: payPeriodId },
    });
    if (!period) return { error: "Pay period not found" };
    if (period.status !== "APPROVED") {
      return { error: "Only approved pay periods can be marked as paid" };
    }

    await db.payPeriod.update({
      where: { id: payPeriodId },
      data: {
        status: "PAID",
        paidAt: new Date(),
      },
    });

    revalidatePath("/payouts");
    revalidatePath(`/payouts/${payPeriodId}`);
    revalidatePath("/my-pay");
    return { success: true };
  } catch (error) {
    console.error("Error completing pay period:", error);
    return { error: "Failed to complete pay period" };
  }
}
