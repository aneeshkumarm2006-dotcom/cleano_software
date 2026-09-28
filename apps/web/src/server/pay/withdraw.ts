// Requesting a withdrawal: the rules the web's requestWithdrawal action has
// always applied, moved here so the phone's POST /api/v1/pay/withdrawals runs
// the same code (API_V1.md §5; the spec is packages/api/src/v1/pay.ts).
//
// Kept from the web, deliberately:
//   - the person asks for an amount; the instant fee comes out of it; the row
//     is recorded at the NET (so admin screens and payout processing read it
//     as always), with the fee in feeAmount beside it;
//   - paymentMethod stays null: how the money goes out is the office's call;
//   - an INFO alert for the office, an email to the cleaner, and one to the
//     company's OWNER and ADMIN users only (never OPS_MANAGER or FIELD_LEAD)
//     naming the net amount.
//
// Changed on purpose: the balance loses the WHOLE amount asked for (net +
// fee), not just the net; before feeAmount existed the fee stayed in the
// balance and could be withdrawn again. See ./balance.ts.
//
// Stricter than the web was, because the contract requires it:
//   - the balance check is on the amount ASKED FOR, before the fee. The web
//     action was handed the net by its modal and checked only that, so a
//     hand-made call could withdraw the whole balance with no fee taken;
//   - the fee is computed HERE from WITHDRAWAL_FEE_BASIS_POINTS, never taken
//     from the client, and a client that showed a different rate is refused
//     (FEE_CHANGED) rather than charged a fee the person never saw;
//   - the balance read and the insert happen in ONE transaction holding a
//     per-person advisory lock, so two requests sent together can't both see
//     the whole balance and overdraw it (the web action had that race);
//   - money is integer cents from end to end;
//   - the emails are effects, fired after the commit (and, on v1, never for
//     a replayed request).
import "server-only";

import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";
import { sendAdminPayoutRequest, sendProviderPayoutRequested } from "@/lib/email";
import {
  WITHDRAWAL_FEE_BASIS_POINTS,
  WITHDRAWAL_MINIMUM_CENTS,
  formatCents,
  withdrawalFeeCents,
} from "@/lib/withdrawal-rules";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { approvalPush } from "../push/notify";
import { failure, ok, type Result } from "../result";
import { readBalance } from "./balance";

export interface WithdrawalInput {
  /** What the person asked for, before the fee. */
  amountCents: number;
  /** The fee rate the person was shown and agreed to. */
  expectedFeeBasisPoints: number;
  note?: string | null;
  now: Date;
}

export interface WithdrawalValue {
  id: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: "PENDING";
  requestedAt: Date;
  note: string | null;
  /** The balance left: the balance before, less net + fee. Never below zero. */
  availableCents: number;
}

const NOTE_MAX = 500;

/**
 * A transaction-scoped lock on one person's withdrawals in one company.
 * Released by the commit or rollback, so it can't leak, and it works through
 * the transaction pooler because it never outlives the transaction.
 */
export async function lockWithdrawalsOf(
  tx: { $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  organizationId: string,
  employeeId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bookmops:withdrawal'), hashtext(${`${organizationId}:${employeeId}`}))`;
}

export async function requestWithdrawalService(
  actor: Actor,
  input: WithdrawalInput,
): Promise<Result<WithdrawalValue>> {
  const { amountCents, expectedFeeBasisPoints } = input;

  // Fail closed on anything that isn't a whole, positive number of cents.
  if (!Number.isSafeInteger(amountCents) || amountCents < WITHDRAWAL_MINIMUM_CENTS) {
    return failure(400, "AMOUNT_TOO_SMALL", "Amount must be greater than zero");
  }
  if (!Number.isInteger(expectedFeeBasisPoints) || expectedFeeBasisPoints < 0 || expectedFeeBasisPoints > 10_000) {
    return failure(400, "VALIDATION_FAILED", "Something in that request wasn't right.");
  }
  if (expectedFeeBasisPoints !== WITHDRAWAL_FEE_BASIS_POINTS) {
    return failure(
      409,
      "FEE_CHANGED",
      "The processing fee has changed. Check the new amount before you send.",
    );
  }

  const feeCents = withdrawalFeeCents(amountCents, WITHDRAWAL_FEE_BASIS_POINTS);
  const netCents = amountCents - feeCents;
  if (netCents < 1) {
    return failure(400, "AMOUNT_TOO_SMALL", "That's too small to send once the fee is taken.");
  }

  const note = input.note?.trim().slice(0, NOTE_MAX) || null;
  const organizationId = await requireOrgId();
  const who = actor.name ?? "A cleaner";

  const outcome = await db.$transaction(async (tx) => {
    await lockWithdrawalsOf(tx, organizationId, actor.userId);

    // Read under the lock: any request of this person's that committed first
    // is already in the reserved total.
    // The check is on the gross (net + fee): that is what the balance loses.
    const balance = await readBalance(actor.userId, tx);
    if (amountCents > balance.rawCents) {
      return {
        kind: "refused" as const,
        failure: failure(
          409,
          "INSUFFICIENT_BALANCE",
          `Amount exceeds available balance (${formatCents(balance.availableCents)})`,
        ),
      };
    }

    const row = await tx.withdrawal.create({
      data: {
        employeeId: actor.userId,
        // Stored in dollars, as every existing reader expects: the net.
        amount: netCents / 100,
        // The fee beside it, so the balance reserves net + fee.
        feeAmount: feeCents / 100,
        // Left for the admin to set when the payout is actually processed.
        paymentMethod: null,
        status: "PENDING",
        notes: note,
      },
      select: { id: true, createdAt: true },
    });

    await tx.alert.create({
      data: {
        type: "GENERAL",
        severity: "INFO",
        title: "Withdrawal request",
        message: `${actor.name} requested a withdrawal of ${formatCents(netCents)}`,
        relatedId: row.id,
        relatedType: "Withdrawal",
      },
    });

    return { kind: "created" as const, row, availableCents: Math.max(0, balance.rawCents - amountCents) };
  });

  if (outcome.kind === "refused") return outcome.failure;

  // After the commit. A mail hiccup must not fail the withdrawal itself.
  const effects: Effect[] = [];
  const netDollars = netCents / 100;
  if (actor.email) {
    effects.push(
      effect("withdrawal.provider-email", () =>
        sendProviderPayoutRequested({
          to: actor.email,
          providerName: actor.name ?? "there",
          amount: netDollars,
        }),
      ),
    );
  }
  effects.push(
    effect("withdrawal.admin-email", () => sendAdminPayoutRequest({ providerName: who, amount: netDollars })),
    approvalPush("withdrawal", outcome.row.id, actor.userId, actor.name),
  );

  return ok(
    {
      id: outcome.row.id,
      amountCents: netCents,
      feeCents,
      netCents,
      status: "PENDING",
      requestedAt: outcome.row.createdAt,
      note,
      availableCents: outcome.availableCents,
    },
    effects,
  );
}
