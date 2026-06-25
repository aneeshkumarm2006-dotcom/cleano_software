"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { WithdrawalStatus } from "@prisma/client";
import { sendProviderPayoutCompleted } from "@/lib/email";

type Action = "APPROVE" | "REJECT" | "COMPLETE";

export async function processWithdrawal(
  withdrawalId: string,
  action: Action,
  notes?: string
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
        notes: notes?.trim() ? notes.trim() : withdrawal.notes,
      },
    });

    // Let the cleaner know once the money is actually on its way.
    if (nextStatus === "COMPLETED" && withdrawal.employee?.email) {
      await sendProviderPayoutCompleted({
        to: withdrawal.employee.email,
        providerName: withdrawal.employee.name ?? "there",
        amount: withdrawal.amount,
        paymentMethod: withdrawal.paymentMethod,
      }).catch((e) => console.error("payout-completed email", e));
    }

    revalidatePath("/cleaners/my-pay");
    revalidatePath("/withdrawals");

    return { success: true, withdrawal: updated };
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return { success: false, error: "Failed to process withdrawal" };
  }
}
