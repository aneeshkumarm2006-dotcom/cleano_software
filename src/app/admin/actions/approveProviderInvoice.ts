"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

interface ApproveInput {
  invoiceNumber: string;
  subtotal: number;
  payoutIds: string[];
  notes?: string;
}

type ApproveResult =
  | { success: true; alertId: string }
  | { success: false; error: string };

export async function approveProviderInvoice(
  input: ApproveInput
): Promise<ApproveResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  const userId = session.user.id;

  if (!input.invoiceNumber || input.payoutIds.length === 0) {
    return { success: false, error: "Missing invoice details" };
  }

  try {
    const ownsAll = await db.payout.count({
      where: {
        id: { in: input.payoutIds },
        employeeId: userId,
      },
    });

    if (ownsAll !== input.payoutIds.length) {
      return {
        success: false,
        error: "Some payouts do not belong to you",
      };
    }

    const message = `${session.user.name} approved provider invoice ${input.invoiceNumber} totaling $${input.subtotal.toFixed(2)} (${input.payoutIds.length} payout${input.payoutIds.length === 1 ? "" : "s"})${input.notes ? ` — ${input.notes.trim()}` : ""}`;

    const alert = await db.alert.create({
      data: {
        type: "GENERAL",
        severity: "INFO",
        title: "Provider invoice approved",
        message,
        relatedId: userId,
        relatedType: "ProviderInvoice",
      },
    });

    revalidatePath("/cleaners/my-pay");

    return { success: true, alertId: alert.id };
  } catch (error) {
    console.error("Error approving provider invoice:", error);
    return { success: false, error: "Failed to approve invoice" };
  }
}
