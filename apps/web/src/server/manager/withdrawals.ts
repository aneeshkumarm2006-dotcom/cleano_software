// The office's withdrawal queue and deciding one
// (packages/api/src/v1/manager-approvals.ts, "Withdrawals").
//
// One implementation, two front doors: the web's processWithdrawal action is
// a thin adapter over decideWithdrawal below, and so is the phone's
// POST /manager/withdrawals/:id/decision.
//
// The transitions are the web's (TRANSITIONS), each one conditional update on
// its from-states (manager-access.ts rule 10), inside a transaction that first
// takes the SAME advisory lock a withdrawal request takes (server/pay/
// withdraw.ts lockWithdrawalsOf: hashtext('bookmops:withdrawal') + org:person).
// So a decision and that person's new request never interleave: the request's
// balance read sees the decision either wholly before or wholly after it.
// The amount is never touched: the fee was taken when the row was written.
//
// Nobody decides their own (403 SELF_APPROVAL), and the queue never lists it.
import "server-only";

import type { ManagedWithdrawal, WithdrawalsQueueResponse } from "@bookmops/api/v1";
import { can, PAYMENT_METHODS } from "@bookmops/api/v1";
import type { PaymentType, Prisma, WithdrawalStatus } from "@prisma/client";

import { logActivity } from "@/lib/activity-log";
import { sendProviderPayoutCompleted } from "@/lib/email";
import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";
import { formatCents } from "@/lib/withdrawal-rules";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { failure, notFound, ok, type Result } from "../result";
import { lockWithdrawalsOf } from "../pay/withdraw";
import { afterKeyset, badCursor, decodeKeyset, pageBy } from "./cursor";

/** "Mark paid" emails the cleaner (manager-access.ts rule 7). */
export const WITHDRAWAL_DECISION_LIMIT = { name: "manager-withdrawal-decision", max: 60, windowMs: 60 * 60_000 };

export type WithdrawalAction = "APPROVE" | "REJECT" | "COMPLETE";

const TRANSITIONS: Record<WithdrawalAction, { from: WithdrawalStatus[]; to: WithdrawalStatus }> = {
  APPROVE: { from: ["PENDING"], to: "APPROVED" },
  REJECT: { from: ["PENDING", "APPROVED"], to: "REJECTED" },
  COMPLETE: { from: ["APPROVED", "PENDING"], to: "COMPLETED" },
};

/** The web's words for a withdrawal that is not in a from-state when read. */
const WRONG_STATE: Record<WithdrawalAction, string> = {
  APPROVE: "Only pending withdrawals can be approved",
  REJECT: "This withdrawal cannot be rejected",
  COMPLETE: "Only pending or approved withdrawals can be completed",
};
const RACED = "This withdrawal was already updated — refresh to see where it stands.";
export const SELF_WITHDRAWAL = "You can't process your own withdrawal. Another admin has to.";
const NOT_FOUND = "Withdrawal not found";
const FORBIDDEN = "Your role can't do this.";

const OPEN: WithdrawalStatus[] = ["PENDING", "APPROVED"];
const HANDLED: WithdrawalStatus[] = ["COMPLETED", "REJECTED"];
const PAGE_SIZE = 30;

const ROW_SELECT = {
  id: true,
  employeeId: true,
  amount: true,
  status: true,
  paymentMethod: true,
  notes: true,
  createdAt: true,
  processedAt: true,
  employee: { select: { name: true, email: true } },
} as const satisfies Prisma.WithdrawalSelect;
type Row = Prisma.WithdrawalGetPayload<{ select: typeof ROW_SELECT }>;

const cents = (dollars: number) => Math.round(dollars * 100);

function toManaged(r: Row): ManagedWithdrawal {
  return {
    id: r.id,
    employee: { id: r.employeeId, name: r.employee.name },
    amountCents: cents(r.amount),
    status: r.status,
    paymentMethod: r.paymentMethod,
    note: r.notes,
    requestedAt: r.createdAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
  } as ManagedWithdrawal;
}

/** GET /manager/withdrawals: open oldest first, handled newest first; never the caller's own. */
export async function listWithdrawalsFor(
  actor: Actor,
  status: "open" | "handled",
  cursorRaw: string | undefined,
): Promise<Result<WithdrawalsQueueResponse>> {
  if (!can(actor.role, "WITHDRAWALS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const cursor = decodeKeyset(cursorRaw);
  if (cursor === "invalid") return badCursor();
  const open = status === "open";
  const dir = open ? "asc" : "desc";
  const notMine = { employeeId: { not: actor.userId } };
  const [rows, total] = await Promise.all([
    db.withdrawal.findMany({
      where: { AND: [notMine, { status: { in: open ? OPEN : HANDLED } }, afterKeyset("createdAt", dir, cursor)] },
      orderBy: [{ createdAt: dir }, { id: dir }],
      take: PAGE_SIZE + 1,
      select: ROW_SELECT,
    }),
    db.withdrawal.findMany({ where: { ...notMine, status: { in: OPEN } }, select: { amount: true } }),
  ]);
  const page = pageBy(rows, PAGE_SIZE, (r) => ({ at: r.createdAt, id: r.id }));
  return ok({
    items: page.rows.map(toManaged),
    nextCursor: page.nextCursor,
    // Summed per row in cents, as the panel shows each row, so the header is
    // the sum of what is listed.
    openTotalCents: total.reduce((s, r) => s + cents(r.amount), 0),
  });
}

/** The Approvals badge's withdrawal count. */
export async function openWithdrawalCount(actor: Actor): Promise<number> {
  return db.withdrawal.count({ where: { employeeId: { not: actor.userId }, status: { in: OPEN } } });
}

/** GET /manager/withdrawals/:id */
export async function withdrawalFor(actor: Actor, id: string): Promise<Result<ManagedWithdrawal>> {
  if (!can(actor.role, "WITHDRAWALS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  const row = await db.withdrawal.findFirst({ where: { id }, select: ROW_SELECT });
  if (!row) return notFound(NOT_FOUND);
  if (row.employeeId === actor.userId) return failure(403, "SELF_APPROVAL", SELF_WITHDRAWAL);
  return ok(toManaged(row));
}

export interface WithdrawalDecisionInput {
  action: WithdrawalAction;
  /** Undefined keeps what is recorded (the web); the phone always sends it, or null to REJECT. */
  paymentMethod?: PaymentType | null;
  /** The web's office note, written over the cleaner's own. The phone never sends one. */
  notes?: string;
  now: Date;
  via: "web" | "app";
}

/**
 * Move a withdrawal along. One conditional update under the person's
 * withdrawal lock; the "money's on its way" email is an effect, after the
 * commit, and only for the decision that actually landed.
 */
export async function decideWithdrawal(
  actor: Actor,
  id: string,
  input: WithdrawalDecisionInput,
): Promise<Result<ManagedWithdrawal>> {
  if (!can(actor.role, "WITHDRAWALS")) return failure(403, "FORBIDDEN", FORBIDDEN);
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, input.action)) {
    return failure(400, "VALIDATION_FAILED", "Invalid action");
  }
  if (input.paymentMethod != null && !(PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) {
    return failure(400, "VALIDATION_FAILED", "Pick how the payout is being sent.");
  }
  const found = await db.withdrawal.findFirst({ where: { id }, select: ROW_SELECT });
  if (!found) return notFound(NOT_FOUND);
  // An owner or admin who also takes pay requests withdrawals like anyone
  // else. Approving or completing their own is paying themselves.
  if (found.employeeId === actor.userId) return failure(403, "SELF_APPROVAL", SELF_WITHDRAWAL);
  const t = TRANSITIONS[input.action];
  // The friendly message for a request already in the wrong state when read;
  // the conditional update below is what makes it true when written.
  if (!t.from.includes(found.status)) return failure(409, "WITHDRAWAL_STATE", WRONG_STATE[input.action]);

  const organizationId = await requireOrgId();
  const notes = input.notes?.trim() || undefined;
  const updated = await db.$transaction(async (tx) => {
    await lockWithdrawalsOf(tx, organizationId, found.employeeId);
    const claimed = await tx.withdrawal.updateMany({
      where: { id, status: { in: t.from } },
      data: {
        status: t.to,
        ...(t.to === "COMPLETED" || t.to === "REJECTED" ? { processedAt: input.now } : {}),
        ...(notes ? { notes } : {}),
        // Keep whatever was already recorded when this call doesn't set one.
        ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
        processedById: actor.userId,
      },
    });
    if (claimed.count === 0) return null;
    return tx.withdrawal.findFirst({ where: { id }, select: ROW_SELECT });
  });
  if (!updated) return failure(409, "WITHDRAWAL_STATE", RACED);

  const verb = t.to === "APPROVED" ? "approved" : t.to === "COMPLETED" ? "marked paid" : "rejected";
  await logActivity({
    category: "ADMIN",
    action: `withdrawal.${t.to.toLowerCase()}`,
    status: "SUCCESS",
    actorId: actor.userId,
    actorLabel: actor.name,
    targetType: "Withdrawal",
    targetId: id,
    amount: updated.amount,
    message:
      `${actor.name ?? "An admin"} ${verb} ${updated.employee.name}'s withdrawal of ${formatCents(cents(updated.amount))}` +
      (updated.paymentMethod ? ` (${updated.paymentMethod.replace("_", "-").toLowerCase()})` : "") +
      (input.via === "app" ? " from the app." : "."),
  }).catch(() => {});

  const effects: Effect[] = [];
  const to = updated.employee.email;
  if (t.to === "COMPLETED" && to) {
    effects.push(
      effect("payout-completed email", () =>
        sendProviderPayoutCompleted({
          to,
          providerName: updated.employee.name ?? "there",
          amount: updated.amount,
          paymentMethod: updated.paymentMethod,
        }),
      ),
    );
  }
  return ok(toManaged(updated), effects);
}

/**
 * The phone's decision: `paymentMethod` is required to approve or mark paid
 * and refused with a rejection (400), as the panel sends it; no note.
 */
export async function decideWithdrawalFor(
  actor: Actor,
  id: string,
  body: { action: WithdrawalAction; paymentMethod: PaymentType | null },
  now: Date,
): Promise<Result<ManagedWithdrawal>> {
  if (body.action === "REJECT" && body.paymentMethod !== null) {
    return failure(400, "VALIDATION_FAILED", "A rejection doesn't take a payment method.");
  }
  if (body.action !== "REJECT" && !body.paymentMethod) {
    return failure(400, "VALIDATION_FAILED", "Pick how the payout is being sent.");
  }
  return decideWithdrawal(actor, id, {
    action: body.action,
    paymentMethod: body.action === "REJECT" ? undefined : body.paymentMethod,
    now,
    via: "app",
  });
}
