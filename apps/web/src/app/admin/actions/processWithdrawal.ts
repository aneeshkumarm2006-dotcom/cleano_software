"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { PaymentType, WithdrawalStatus } from "@prisma/client";
import { sendProviderPayoutCompleted } from "@/lib/email";

type Action = "APPROVE" | "REJECT" | "COMPLETE";

/**
 * Each action, the states it may move a withdrawal OUT of, and where it lands.
 *
 * The from-states are written into the update itself (`updateMany` on
 * id + status), not just checked on a read beforehand. Two admins working the
 * payouts page at once both pass a read: one COMPLETES (the money goes out)
 * while the other REJECTS (the balance comes back), and the cleaner is paid
 * twice. With the states in the WHERE, exactly one of them gets the row.
 */
const TRANSITIONS: Record<Action, { from: WithdrawalStatus[]; to: WithdrawalStatus }> = {
  APPROVE: { from: ["PENDING"], to: "APPROVED" },
  REJECT: { from: ["PENDING", "APPROVED"], to: "REJECTED" },
  COMPLETE: { from: ["APPROVED", "PENDING"], to: "COMPLETED" },
};

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

  if (typeof withdrawalId !== "string" || !withdrawalId) {
    return { success: false, error: "Withdrawal not found" };
  }
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, action)) {
    return { success: false, error: "Invalid action" };
  }

  try {
    const withdrawal = await db.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { employee: true },
    });

    if (!withdrawal) {
      return { success: false, error: "Withdrawal not found" };
    }

    // An owner or admin who also takes pay requests withdrawals like anyone
    // else. Approving or completing their own is paying themselves.
    if (withdrawal.employeeId === session.user.id) {
      return {
        success: false,
        error: "You can't process your own withdrawal. Another admin has to.",
      };
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

    // The switch above gives the friendly message for a request that was
    // already in the wrong state when read; this is what makes it true at the
    // moment of writing (see TRANSITIONS).
    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: { in: TRANSITIONS[action].from } },
        data: {
          status: nextStatus,
          ...(nextStatus === "COMPLETED" || nextStatus === "REJECTED"
            ? { processedAt: new Date() }
            : {}),
          ...(opts.notes?.trim() ? { notes: opts.notes.trim() } : {}),
          // Keep whatever was already recorded when this call doesn't set one.
          ...(opts.paymentMethod !== undefined
            ? { paymentMethod: opts.paymentMethod }
            : {}),
        },
      });
      if (claimed.count === 0) return null;
      return tx.withdrawal.findUnique({ where: { id: withdrawalId } });
    });
    if (!updated) {
      return {
        success: false,
        error: "This withdrawal was already updated — refresh to see where it stands.",
      };
    }

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
