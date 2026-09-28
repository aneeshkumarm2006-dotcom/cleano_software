"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { PaymentType } from "@prisma/client";
import { actorFromSession } from "@/server/actor";
import { flushEffects } from "@/server/effects";
import { decideWithdrawal, type WithdrawalAction } from "@/server/manager/withdrawals";

type Action = WithdrawalAction;

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
  if (action !== "APPROVE" && action !== "REJECT" && action !== "COMPLETE") {
    return { success: false, error: "Invalid action" };
  }

  try {
    // The decision is the shared service (server/manager/withdrawals.ts), the
    // one the phone's approvals run: the self rule, the conditional update
    // under the person's withdrawal lock, who processed it, the activity line,
    // and the "on its way" email as an effect of the decision that landed.
    const res = await decideWithdrawal(
      actorFromSession({ ...session.user, role: role ?? null }),
      withdrawalId,
      {
        action,
        paymentMethod: opts.paymentMethod,
        notes: opts.notes,
        now: new Date(),
        via: "web",
      },
    );
    if (!res.ok) return { success: false, error: res.message };
    await flushEffects(null, res.effects);

    revalidatePath("/cleaners/my-pay");
    revalidatePath("/admin/payouts");

    return { success: true, withdrawal: res.value };
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return { success: false, error: "Failed to process withdrawal" };
  }
}
