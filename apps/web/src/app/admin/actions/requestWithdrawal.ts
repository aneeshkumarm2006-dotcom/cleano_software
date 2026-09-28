"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { isStaffRole } from "@/lib/role-routing";

import { actorFromSession } from "@/server/actor";
import { fireEffects } from "@/server/effects";
import { revalidateAfterWithdrawal } from "@/server/pay/revalidate";
import { requestWithdrawalService } from "@/server/pay/withdraw";

/**
 * A cleaner submits an AMOUNT, nothing else (new fix list item 3).
 *
 * How the money actually goes out is an admin/back-office decision, so
 * `Withdrawal.paymentMethod` is left null here and filled in when an admin
 * approves or pays the request.
 *
 * The rules live in server/pay/withdraw.ts, shared with the phone's
 * POST /api/v1/pay/withdrawals. The modal sends what the person ASKED FOR and
 * the fee rate it showed them; the server takes the fee itself, checks the
 * amount asked for against the balance, and records the net. (The modal used
 * to send the net, which the server then trusted.)
 */
interface RequestWithdrawalInput {
  /** What the person asked for, before the fee, in cents. */
  amountCents: number;
  /** The fee rate the modal showed, in basis points. */
  expectedFeeBasisPoints: number;
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
  if (!isStaffRole((session.user as { role?: string }).role)) {
    return { success: false, error: "Not authorized" };
  }

  // A page loaded before this change sends `{ amount }` (the net, in dollars).
  // Its meaning changed, so it is refused rather than guessed at.
  const amountCents = Number(input?.amountCents);
  const expectedFeeBasisPoints = Number(input?.expectedFeeBasisPoints);
  if (!Number.isFinite(amountCents) || !Number.isFinite(expectedFeeBasisPoints)) {
    return { success: false, error: "This page is out of date. Refresh it and try again." };
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { success: false, error: "Amount must be greater than zero" };
  }

  const actor = actorFromSession(
    session.user as { id: string; name?: string | null; email: string; role?: string | null },
  );

  try {
    const result = await requestWithdrawalService(actor, {
      amountCents,
      expectedFeeBasisPoints,
      note: typeof input.notes === "string" ? input.notes : null,
      now: new Date(),
    });
    if (!result.ok) return { success: false, error: result.message };

    // Notify the cleaner (confirmation) and admins. Fire-and-forget — a mail
    // hiccup must not fail the withdrawal itself.
    fireEffects(result.effects);
    revalidateAfterWithdrawal();

    return { success: true, withdrawalId: result.value.id };
  } catch (error) {
    console.error("Error requesting withdrawal:", error);
    return { success: false, error: "Failed to request withdrawal" };
  }
}
