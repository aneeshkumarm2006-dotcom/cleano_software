"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { isNotificationEnabled } from "@/lib/notifications";
import type { NotificationGate } from "@/lib/email";
import { computePayoutTotals, summarisePayouts } from "@/lib/payout-math";
import { requireBudgetCategoryId } from "@/lib/budget-categories";
import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "Cleano <no-reply@cleano.ca>";

async function sendPaymentReceivedEmail(opts: {
  to: string;
  name: string;
  amount: number;
  periodLabel: string;
}) {
  const enabled = await isNotificationEnabled(
    "PROVIDER",
    "prov.payments.received",
    "EMAIL"
  );
  if (!enabled || !process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: `Cleano payout — $${opts.amount.toFixed(2)}`,
    html: `<div style="font-family:sans-serif;padding:24px;background:#f5f2ed">
      <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
        <h1 style="color:#00424a;margin:0 0 12px">You just got paid</h1>
        <p style="font-size:15px;color:#333">Hi ${opts.name.split(" ")[0]}, your payout for ${opts.periodLabel} was just processed.</p>
        <p style="font-size:24px;font-weight:700;color:#00424a;margin:18px 0">$${opts.amount.toFixed(2)}</p>
        <p style="font-size:13px;color:#666">Expect funds in your account within 1–2 business days.</p>
      </div>
    </div>`,
  }).catch((e) => console.error("provider payment-received email", e));
}
// Ensure type import is kept (used by other parts of the module).
void {} as NotificationGate | undefined;

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
    // Sum through the canonical helper, not the stored column: a payout written
    // before the $0 floor landed could otherwise subtract from the labour
    // expense and under-state payroll cost. See src/lib/payout-math.ts.
    const totalLabour = summarisePayouts(period.payouts).totalFinal;
    const periodLabel = `${period.startDate.toISOString().slice(0, 10)} → ${period.endDate.toISOString().slice(0, 10)}`;

    // Resolved outside the interactive transaction: it is a read the payroll
    // posting depends on, and holding the tx open for it buys nothing.
    const labourCategoryId = await requireBudgetCategoryId("labour");

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
          categoryId: labourCategoryId,
          isAuto: true,
          source: `PAY_PERIOD:${payPeriodId}`,
        },
      });

      if (totalLabour > 0) {
        await tx.transaction.create({
          data: {
            date: paidAt,
            categoryId: labourCategoryId,
            amount: totalLabour,
            description: `Payroll for pay period ${periodLabel}`,
            source: `PAY_PERIOD:${payPeriodId}`,
            isAuto: true,
          },
        });
      }
    });

    // Notify each cleaner who received a payout — gated by `prov.payments.received` EMAIL.
    const byEmployee = new Map<string, number>();
    for (const p of period.payouts) {
      byEmployee.set(
        p.employeeId,
        (byEmployee.get(p.employeeId) ?? 0) + computePayoutTotals(p).final
      );
    }
    const employees = await db.user.findMany({
      where: { id: { in: Array.from(byEmployee.keys()) } },
      select: { id: true, name: true, email: true },
    });
    for (const u of employees) {
      const amount = byEmployee.get(u.id) ?? 0;
      if (amount <= 0 || !u.email) continue;
      sendPaymentReceivedEmail({
        to: u.email,
        name: u.name,
        amount,
        periodLabel,
      }).catch((e) => console.error("provider payment email", e));
    }

    revalidatePath("/admin/payouts");
    revalidatePath(`/admin/payouts/${payPeriodId}`);
    revalidatePath("/cleaners/my-pay");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error) {
    console.error("Error completing pay period:", error);
    return { error: "Failed to complete pay period" };
  }
}
