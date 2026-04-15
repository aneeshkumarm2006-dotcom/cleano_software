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
      include: { payouts: true },
    });
    if (!period) return { error: "Pay period not found" };
    if (period.status !== "APPROVED") {
      return { error: "Only approved pay periods can be marked as paid" };
    }

    const paidAt = new Date();
    const totalLabour = period.payouts.reduce(
      (sum, p) => sum + p.finalAmount,
      0
    );
    const periodLabel = `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;

    await db.$transaction(async (tx) => {
      await tx.payPeriod.update({
        where: { id: payPeriodId },
        data: {
          status: "PAID",
          paidAt,
        },
      });

      await tx.transaction.deleteMany({
        where: {
          category: "LABOUR",
          isAuto: true,
          source: `PAY_PERIOD:${payPeriodId}`,
        },
      });

      if (totalLabour > 0) {
        await tx.transaction.create({
          data: {
            date: paidAt,
            category: "LABOUR",
            amount: totalLabour,
            description: `Payroll for pay period ${periodLabel}`,
            source: `PAY_PERIOD:${payPeriodId}`,
            isAuto: true,
          },
        });
      }
    });

    revalidatePath("/payouts");
    revalidatePath(`/payouts/${payPeriodId}`);
    revalidatePath("/my-pay");
    revalidatePath("/finances");
    return { success: true };
  } catch (error) {
    console.error("Error completing pay period:", error);
    return { error: "Failed to complete pay period" };
  }
}
