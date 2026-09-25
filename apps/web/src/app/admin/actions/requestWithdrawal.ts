"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  sendProviderPayoutRequested,
  sendAdminPayoutRequest,
} from "@/lib/email";
import { summarisePayouts } from "@/lib/payout-math";

/**
 * A cleaner submits an AMOUNT, nothing else (new fix list item 3).
 *
 * How the money actually goes out is an admin/back-office decision, so
 * `Withdrawal.paymentMethod` is left null here and filled in when an admin
 * approves or pays the request.
 */
interface RequestWithdrawalInput {
  amount: number;
  notes?: string;
}

type WithdrawalResult =
  | { success: true; withdrawalId: string }
  | { success: false; error: string };

export async function requestWithdrawal(
  input: RequestWithdrawalInput
): Promise<WithdrawalResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  const userId = session.user.id;
  const amount = Number(input.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }

  try {
    const [payouts, withdrawals] = await Promise.all([
      db.payout.findMany({
        where: { employeeId: userId },
        include: { payPeriod: true },
      }),
      db.withdrawal.findMany({
        where: { employeeId: userId },
      }),
    ]);

    // Clamped read — a legacy negative payout must not shrink the withdrawable
    // balance below what the cleaner was actually paid (fix list item 1).
    const paidTotal = summarisePayouts(
      payouts.filter((p) => p.payPeriod.status === "PAID")
    ).totalFinal;

    const reservedTotal = withdrawals
      .filter(
        (w) =>
          w.status === "PENDING" ||
          w.status === "APPROVED" ||
          w.status === "COMPLETED"
      )
      .reduce((sum, w) => sum + w.amount, 0);

    const available = paidTotal - reservedTotal;

    if (amount > available + 0.001) {
      return {
        success: false,
        error: `Amount exceeds available balance ($${available.toFixed(2)})`,
      };
    }

    const withdrawal = await db.withdrawal.create({
      data: {
        employeeId: userId,
        amount,
        // Left for the admin to set when the payout is actually processed.
        paymentMethod: null,
        status: "PENDING",
        notes: input.notes?.trim() || null,
      },
    });

    await db.alert.create({
      data: {
        type: "GENERAL",
        severity: "INFO",
        title: "Withdrawal request",
        message: `${session.user.name} requested a withdrawal of $${amount.toFixed(2)}`,
        relatedId: withdrawal.id,
        relatedType: "Withdrawal",
      },
    });

    // Notify the cleaner (confirmation) and admins. Fire-and-forget — a mail
    // hiccup must not fail the withdrawal itself.
    const email = (session.user as { email?: string }).email;
    const providerName = session.user.name ?? "there";
    if (email) {
      await sendProviderPayoutRequested({
        to: email,
        providerName,
        amount,
      }).catch((e) => console.error("payout-requested email", e));
    }
    await sendAdminPayoutRequest({
      providerName: session.user.name ?? "A cleaner",
      amount,
    }).catch((e) => console.error("admin payout-request email", e));

    revalidatePath("/cleaners/my-pay");

    return { success: true, withdrawalId: withdrawal.id };
  } catch (error) {
    console.error("Error requesting withdrawal:", error);
    return { success: false, error: "Failed to request withdrawal" };
  }
}
