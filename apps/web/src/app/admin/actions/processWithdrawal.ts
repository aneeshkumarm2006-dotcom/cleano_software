"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { PaymentType, WithdrawalStatus } from "@prisma/client";
import { sendProviderPayoutCompleted } from "@/lib/email";

type Action = "APPROVE" | "REJECT" | "COMPLETE";

interface ProcessOptions {
  notes?: string;
  /**
   * How the payout is being sent. Chosen HERE, by an admin — cleaners submit an
   * amount only (new fix list item 3). Left null until someone picks one.
   */
  paymentMethod?: PaymentType | null;
}

export async function processWithdrawal(
  withdrawalId: string,
  action: Action,
  opts: ProcessOptions = {}
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  const role = (session.user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "OWNER") {
    return { success: false, error: "Not authorized" };
  }

  try {
    const withdrawal = await db.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { employee: true },
    });

    if (!withdrawal) {
      return { success: false, error: "Withdrawal not found" };
    }

    let nextStatus: WithdrawalStatus;
    switch (action) {
      case "APPROVE":
        if (withdrawal.status !== "PENDING") {
          return {
            success: false,
            error: "Only pending withdrawals can be approved",
          };
        }
        nextStatus = "APPROVED";
        break;
      case "REJECT":
        if (withdrawal.status !== "PENDING" && withdrawal.status !== "APPROVED") {
          return {
            success: false,
            error: "This withdrawal cannot be rejected",
          };
        }
        nextStatus = "REJECTED";
        break;
      case "COMPLETE":
        if (withdrawal.status !== "APPROVED" && withdrawal.status !== "PENDING") {
          return {
            success: false,
            error: "Only pending or approved withdrawals can be completed",
          };
        }
        nextStatus = "COMPLETED";
        break;
      default:
        return { success: false, error: "Invalid action" };
    }

    const updated = await db.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: nextStatus,
        processedAt:
          nextStatus === "COMPLETED" || nextStatus === "REJECTED"
            ? new Date()
            : withdrawal.processedAt,
        notes: opts.notes?.trim() ? opts.notes.trim() : withdrawal.notes,
        // Keep whatever was already recorded when this call doesn't set one.
        paymentMethod:
          opts.paymentMethod !== undefined
            ? opts.paymentMethod
            : withdrawal.paymentMethod,
      },
    });

    // Let the cleaner know once the money is actually on its way.
    if (nextStatus === "COMPLETED" && withdrawal.employee?.email) {
      await sendProviderPayoutCompleted({
        to: withdrawal.employee.email,
        providerName: withdrawal.employee.name ?? "there",
        amount: withdrawal.amount,
        paymentMethod: updated.paymentMethod,
      }).catch((e) => console.error("payout-completed email", e));
    }

    revalidatePath("/cleaners/my-pay");
    revalidatePath("/admin/payouts");

    return { success: true, withdrawal: updated };
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return { success: false, error: "Failed to process withdrawal" };
  }
}
