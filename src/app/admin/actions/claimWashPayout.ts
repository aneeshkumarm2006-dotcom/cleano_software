"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { availablePayout } from "@/lib/wash";

/**
 * Drain whatever full payout units the cleaner has accumulated, write a
 * WashPayout row, and return the amount. Stripe transfer is left as PENDING —
 * a later session will wire that into Stripe Connect.
 */
export async function claimWashPayout(): Promise<
  | { success: true; payoutId: string; amount: number }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };

  try {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { ragCredits: true, padCredits: true },
    });
    if (!user) return { success: false, error: "User not found" };

    const payable = availablePayout(user.ragCredits, user.padCredits);
    if (payable.amount <= 0) {
      return {
        success: false,
        error: "Not enough credits to claim a payout yet.",
      };
    }

    // Atomically: drain ledger + create payout row. The conditional decrement
    // (credits must still cover what we're consuming) means two concurrent
    // claims can't both drain the same credits / double-pay.
    const payout = await db.$transaction(async (tx) => {
      const claim = await tx.user.updateMany({
        where: {
          id: session.user.id,
          ragCredits: { gte: payable.ragCreditsConsumed },
          padCredits: { gte: payable.padCreditsConsumed },
        },
        data: {
          ragCredits: { decrement: payable.ragCreditsConsumed },
          padCredits: { decrement: payable.padCreditsConsumed },
        },
      });
      if (claim.count === 0) {
        throw new Error("Credits already claimed");
      }
      return tx.washPayout.create({
        data: {
          employeeId: session.user.id,
          ragCreditsUsed: payable.ragCreditsConsumed,
          padCreditsUsed: payable.padCreditsConsumed,
          amount: payable.amount,
          status: "PENDING",
        },
      });
    });

    revalidatePath("/cleaners/my-inventory/rag-wash");
    revalidatePath("/admin/wash-payouts");
    return { success: true, payoutId: payout.id, amount: payable.amount };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("claimWashPayout failed", e);
    return { success: false, error: `Failed to claim: ${detail}` };
  }
}
