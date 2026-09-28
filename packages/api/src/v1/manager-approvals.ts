// The office's approval queues: clock times, withdrawals, kit restocks.
//
// Replaces, for the phone, the web's actions/decideTimeLogChange.ts (with
// updateClockTimes.ts behind it), actions/processWithdrawal.ts with
// payouts/WithdrawalsPanel.tsx, and actions/resolveInventoryRequest.ts.
// Access follows ./manager-access.ts, and every rule at the bottom of that
// file applies. Days off have no approval on the web (a cleaner's day off is
// recorded as they enter it, actions/availabilityExceptions.ts), so there is
// no queue for them here.
import { z } from "zod";

import { Cents, Instant, openEnum, page } from "./common";

// ---- Counts ---------------------------------------------------------------------

/**
 * GET /api/v1/manager/approvals/summary — how many are waiting in each queue,
 * for the Approvals tab's badge. A queue the caller's role can't act on is
 * NULL (not 0), so the app hides it rather than showing an empty tab.
 *
 * Access: TIME_APPROVE, WITHDRAWALS or KIT_REQUESTS (any one; else 403).
 *   time:        PENDING time items (both kinds below) the caller could
 *                decide: company-wide, or the caller's group for a FIELD_LEAD;
 *   withdrawals: PENDING and APPROVED withdrawals (the web's "open"), if WITHDRAWALS;
 *   kit:         PENDING inventory requests, if KIT_REQUESTS.
 * Each count leaves out the caller's own items (manager-access.ts rule 9),
 * exactly as the lists below do, so the badge never counts one the caller
 * can't open.
 */
export const ApprovalsSummaryResponse = z.object({
  time: z.number().int().nullable(),
  withdrawals: z.number().int().nullable(),
  kit: z.number().int().nullable(),
});
export type ApprovalsSummaryResponse = z.infer<typeof ApprovalsSummaryResponse>;

// ---- Clock times ------------------------------------------------------------------

/**
 * Where a time item came from:
 *   OFFLINE_CLOCK    the server applied a phone's offline clock event at the
 *                    time it arrived and wants the office to rule on the time
 *                    the phone says it happened (API_V1.md §6: offline proven
 *                    and the gap over five minutes, offline disproven, or an
 *                    event that couldn't be applied as sent);
 *   CLEANER_REQUEST  a cleaner asked for their own times to be corrected
 *                    (cleaners/actions/timeLogRequests.ts).
 * Both are TimeLogChangeRequest rows; OFFLINE_CLOCK rows carry the event's
 * clientEventId, occurredAt and receivedAt (new columns, staging first).
 */
export const TIME_ITEM_KINDS = ["OFFLINE_CLOCK", "CLEANER_REQUEST"] as const;
export const TIME_ITEM_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
/** For an OFFLINE_CLOCK item: which tap it was. */
export const OFFLINE_EVENTS = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;
/** For an OFFLINE_CLOCK item: why it came to the office (§6). */
export const OFFLINE_REASONS = ["GAP_OVER_LIMIT", "NOT_PROVEN_OFFLINE", "COULD_NOT_APPLY"] as const;

/** The longest note on a decision: core TIME_LOG_REASON_MAX. */
export const DECISION_NOTE_MAX = 500;

export const TimeItem = z.object({
  id: z.string(),
  kind: openEnum(TIME_ITEM_KINDS),
  status: openEnum(TIME_ITEM_STATUSES),
  cleaner: z.object({ id: z.string(), name: z.string() }),
  job: z.object({
    id: z.string(),
    jobNumber: z.number().int(),
    /**
     * The client's name as the web's queue shows it (listTimeLogRequests);
     * the FIRST name only for a FIELD_LEAD, as everywhere a lead sees a
     * client (manager-team.ts TeamJob `client.name`).
     */
    clientName: z.string().nullable(),
    startsAt: Instant,
  }),
  /** The times on record now (what applies until someone decides). */
  current: z.object({ start: Instant.nullable(), end: Instant.nullable() }),
  /**
   * The times on record when the request was made, as stored with it. A
   * decided item's "before": once approved, `current` already holds the new
   * times. Absent from older servers; fall back to `current`.
   */
  original: z.object({ start: Instant.nullable(), end: Instant.nullable() }).optional(),
  /**
   * The times asked for: the cleaner's request, or the phone's claimed time.
   * A side nobody asked to change is null and is kept as it stands.
   */
  requested: z.object({ start: Instant.nullable(), end: Instant.nullable() }),
  /** The cleaner's reason, in their words. Null for an OFFLINE_CLOCK item. */
  reason: z.string().nullable(),
  offline: z
    .object({
      event: openEnum(OFFLINE_EVENTS),
      why: openEnum(OFFLINE_REASONS),
      /** When the phone says the tap happened. */
      occurredAt: Instant,
      /** When the server got it. */
      receivedAt: Instant,
    })
    .nullable(),
  createdAt: Instant,
  decided: z
    .object({
      by: z.string(),
      at: Instant,
      note: z.string().nullable(),
    })
    .nullable(),
});
export type TimeItem = z.infer<typeof TimeItem>;

/**
 * GET /api/v1/manager/approvals/time?status=pending|decided&cursor= — the
 * clock-time queue: pending oldest first (they have waited longest), decided
 * newest first, keyset-paged.
 *
 * Access: TIME_APPROVE.
 *   - OWNER, ADMIN, OPS_MANAGER: company-wide, as the web
 *     (decideTimeLogChange.ts checks isAdminRole and nothing narrower);
 *   - FIELD_LEAD: only items whose cleaner is in the caller's group
 *     (fieldLeadGroupIds, resolved server-side). The web is company-wide for
 *     a lead too; the phone is deliberately narrower, since a lead has no
 *     business ruling on hours they didn't oversee;
 *   - never the caller's own items, for any role (manager-access.ts rule 9).
 * GET …/time/:id follows the same rule: another group's item answers 404,
 * the caller's own 403 SELF_APPROVAL (so the app can say why).
 */
export const TimeItemsResponse = page(TimeItem);
export type TimeItemsResponse = z.infer<typeof TimeItemsResponse>;

/** GET /api/v1/manager/approvals/time/:id — one item, for its screen. */
export const TimeItemResponse = TimeItem;

export const TIME_DECISIONS = ["APPROVE", "ADJUST", "REJECT"] as const;
export type TimeDecision = (typeof TIME_DECISIONS)[number];

/**
 * The 409 codes that mean "someone else already decided this" (rule 10 in
 * ./manager-access.ts): each endpoint keeps the web's name for it. The app
 * treats all three the same way: says so, and reloads the item.
 */
export const ALREADY_HANDLED_CODES = ["ALREADY_DECIDED", "WITHDRAWAL_STATE", "ALREADY_RESOLVED"] as const;

export function isAlreadyHandled(code: string | null | undefined): boolean {
  return (ALREADY_HANDLED_CODES as readonly string[]).includes(code ?? "");
}

/**
 * POST /api/v1/manager/approvals/time/:id/decision. Idempotent on
 * `clientEventId`.
 *
 * Access: TIME_APPROVE, and the item in the caller's reach as for the list
 * (a FIELD_LEAD's group, else 404). Refusals before anything is applied:
 *   - the item's cleaner is the caller: 403 SELF_APPROVAL (rule 9);
 *   - ADJUST without TIME_ADJUST (a FIELD_LEAD): 403 FORBIDDEN. A lead may
 *     APPROVE what was asked or REJECT it, nothing in between.
 * The server does exactly what decideTimeLogChange does, through the same
 * updateClockTimes path an admin's hand correction takes (validation, the
 * pay-period lock, the job and assignment mirrors, the hourly pay and
 * billed-hours snapshots, the JobLog line), in ONE transaction:
 *   - claims the item first with a conditional update, `status = PENDING` in
 *     the WHERE (rule 10). Zero rows: 409 ALREADY_DECIDED, naming how, and
 *     nothing is applied. So two managers deciding at once can't both apply
 *     times; the loser's transaction applies nothing;
 *   - APPROVE applies `requested`, keeping the side nobody asked to change
 *     as it stands NOW (re-read, never the stored original);
 *   - ADJUST applies `start` and `end` as given instead, for when the office
 *     knows the right time and it is neither. `start` is required; `end` is
 *     required when the entry has an end on record, and null only for an
 *     entry still running (updateClockTimes reads null as "clear", so the
 *     server refuses a null end that would wipe a clock-out: 400). Start
 *     before end, by the web's validateClockEdit;
 *   - REJECT applies nothing;
 *   - then applies the times; a refusal there (a locked pay period: 409
 *     PAY_PERIOD_LOCKED, "…still waiting") rolls the whole transaction back,
 *     claim included, so the item stays pending, as the web leaves it;
 *   - records decidedBy, decidedAt and the note, and logActivity's
 *     "timelog.request.approved/rejected" line, with "adjusted" and both
 *     times in it for an ADJUST.
 * `note` is required for ADJUST and REJECT (400 NOTE_REQUIRED): the cleaner
 * sees why their time was changed or refused. Optional for APPROVE.
 * An OFFLINE_CLOCK item approved or adjusted also clears the job's
 * `pendingReview` for that cleaner (clock.ts ClockStateResponse).
 * Response: the item as it now stands.
 */
export const TimeDecisionRequest = z.object({
  decision: z.enum(TIME_DECISIONS),
  start: Instant.nullable().optional(),
  end: Instant.nullable().optional(),
  note: z.string().trim().max(DECISION_NOTE_MAX).optional(),
  clientEventId: z.uuid(),
});
export type TimeDecisionRequest = z.infer<typeof TimeDecisionRequest>;

// ---- Withdrawals --------------------------------------------------------------------

export const MANAGED_WITHDRAWAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const;
/** How a payout is sent (PaymentType). The office picks it; the cleaner never does. */
export const PAYMENT_METHODS = ["E_TRANSFER", "CASH", "CHEQUE", "CREDIT_CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ManagedWithdrawal = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), name: z.string() }),
  /**
   * The stored Withdrawal.amount, in cents: what the cleaner receives. The
   * instant-payout fee was taken before the row was written and isn't stored
   * (pay.ts, WithdrawalRequest), so this is the amount to send, as on the
   * web's panel.
   */
  amountCents: Cents,
  status: openEnum(MANAGED_WITHDRAWAL_STATUSES),
  paymentMethod: openEnum(PAYMENT_METHODS).nullable(),
  /** The cleaner's note with the request. */
  note: z.string().nullable(),
  requestedAt: Instant,
  processedAt: Instant.nullable(),
});
export type ManagedWithdrawal = z.infer<typeof ManagedWithdrawal>;

/**
 * GET /api/v1/manager/withdrawals?status=open|handled&cursor= — open is
 * PENDING and APPROVED, oldest first; handled is COMPLETED and REJECTED,
 * newest first. As the web's WithdrawalsPanel, less the caller's own
 * withdrawals (rule 9).
 *
 * Access: WITHDRAWALS (OWNER, ADMIN). `openTotalCents` sums the open rows'
 * stored amounts, as the panel's header does (the caller's own left out).
 */
export const WithdrawalsQueueResponse = page(ManagedWithdrawal).extend({
  openTotalCents: Cents,
});
export type WithdrawalsQueueResponse = z.infer<typeof WithdrawalsQueueResponse>;

/**
 * GET /api/v1/manager/withdrawals/:id — one, for its screen. Access:
 * WITHDRAWALS; the caller's own answers 403 SELF_APPROVAL.
 */
export const ManagedWithdrawalResponse = ManagedWithdrawal;

export const WITHDRAWAL_ACTIONS = ["APPROVE", "COMPLETE", "REJECT"] as const;
export type WithdrawalAction = (typeof WITHDRAWAL_ACTIONS)[number];

/**
 * POST /api/v1/manager/withdrawals/:id/decision. Idempotent on
 * `clientEventId`.
 *
 * Access: WITHDRAWALS. The withdrawal's employee is the caller: 403
 * SELF_APPROVAL (rule 9); the queue never lists the caller's own either.
 * The transitions are processWithdrawal's, each one conditional update on
 * its from-states inside the transaction (rule 10):
 *   APPROVE   PENDING → APPROVED;
 *   COMPLETE  PENDING or APPROVED → COMPLETED ("Mark paid"), stamps
 *             processedAt and emails the cleaner that the money is on its way;
 *   REJECT    PENDING or APPROVED → REJECTED, stamps processedAt. The amount
 *             returns to the cleaner's available balance, since a rejected
 *             row no longer counts against it (pay.ts).
 * Zero rows updated (the row isn't in a from-state any more, whether it
 * never was or someone else moved it first) answers 409 WITHDRAWAL_STATE
 * with the web's message, and sends no email.
 * `paymentMethod` is required for APPROVE and COMPLETE and refused for
 * REJECT (400), as the panel sends it. No note is sent: the web's action
 * writes an office note over the cleaner's own, so the phone never sends
 * one. Audit: processedBy (new column) and a logActivity line naming the
 * actor, the amount and the method. Rate limit: rule 7.
 * Response: the withdrawal as it now stands.
 */
export const WithdrawalDecisionRequest = z.object({
  action: z.enum(WITHDRAWAL_ACTIONS),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  clientEventId: z.uuid(),
});
export type WithdrawalDecisionRequest = z.infer<typeof WithdrawalDecisionRequest>;

// ---- Kit restocks ---------------------------------------------------------------------

export const KIT_REQUEST_STATUSES = ["PENDING", "APPROVED", "FULFILLED", "REJECTED"] as const;

export const KitRequestItem = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), name: z.string() }),
  /** A product request moves stock when approved. */
  product: z
    .object({
      id: z.string(),
      name: z.string(),
      unit: z.string(),
      /** What the warehouse holds (Product.stockLevel), for the "short" warning. */
      inWarehouse: z.number(),
    })
    .nullable(),
  /** A kit request is only marked approved; the kit is handed out on the web. */
  kit: z.object({ id: z.string(), name: z.string() }).nullable(),
  quantity: z.number(),
  reason: z.string().nullable(),
  status: openEnum(KIT_REQUEST_STATUSES),
  requestedAt: Instant,
});
export type KitRequestItem = z.infer<typeof KitRequestItem>;

/**
 * GET /api/v1/manager/kit-requests?cursor= — PENDING requests, oldest first,
 * less the caller's own (rule 9).
 * Access: KIT_REQUESTS (OWNER, ADMIN).
 */
export const KitRequestsResponse = page(KitRequestItem);
export type KitRequestsResponse = z.infer<typeof KitRequestsResponse>;

/**
 * POST /api/v1/manager/kit-requests/:id/decision. Idempotent on
 * `clientEventId`: approving twice must never move stock twice.
 *
 * Access: KIT_REQUESTS. The request's employee is the caller: 403
 * SELF_APPROVAL (rule 9). As resolveInventoryRequest, in one transaction:
 *   - claims the request first with a conditional update, `status = PENDING`
 *     in the WHERE (rule 10); zero rows answers 409 ALREADY_RESOLVED and
 *     moves no stock, so two approvals at once can't both move it;
 *   - REJECT marks it REJECTED;
 *   - APPROVE of a product request refuses when the warehouse is short
 *     (409 WAREHOUSE_SHORT, the web's "Only N … in the warehouse" message;
 *     the transaction rolls back, claim included, so it stays PENDING),
 *     else moves the quantity from a real location to the cleaner's kit
 *     (pickSourceLocationId, adjustWarehouseStock) with both audit rows, and
 *     marks it FULFILLED;
 *   - APPROVE of a kit request marks it APPROVED; handing out the kit stays
 *     on the web.
 * Response: the request as it now stands.
 */
export const KitDecisionRequest = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  clientEventId: z.uuid(),
});
export type KitDecisionRequest = z.infer<typeof KitDecisionRequest>;
