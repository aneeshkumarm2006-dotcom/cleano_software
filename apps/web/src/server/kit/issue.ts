// Something happened to an item in the caller's kit: lost, broken, ran out, or
// other (kit.ts KitIssueRequest; the web's reportDamagedItem is an adapter).
//
// All in ONE transaction:
//
// 1. The kit goes down by a CONDITIONAL decrement (UPDATE … SET quantity =
//    quantity - n WHERE quantity >= n). Two reports sent at the same moment
//    can't both pass on the same stock: the second waits on the row lock and
//    then finds too little, and nothing changes (409 NOT_ENOUGH_IN_KIT).
//
// 2. LOST and BROKEN are also written off company stock, but only up to what
//    the office actually put in this cleaner's hands. The kit's own count
//    can't be the measure: the cleaner sets it with a recount or "already have
//    it", so trusting it would let anyone write off stock they were never
//    given. Custody, per (cleaner, product), from the audit trail:
//
//      issued-in-place   ASSIGN + ADMIN_SET + IMPORT on the cleaner's rows:
//                        handed over without moving warehouse stock (see
//                        assignToCleanerKit), so writing it off DOES move it;
//      issued-off-stock  PICKUP + REQUEST_FULFILLED on the cleaner's rows:
//                        already taken off a location when it was issued, so
//                        writing it off must NOT take it off again;
//      written off       the warehouse ISSUE rows this cleaner's reports made
//                        (the first kind), plus `issuedWriteOff` on their
//                        own ISSUE rows (the second kind).
//
//    A report is covered from issued-in-place first (the warehouse moves, as
//    reportDamagedItem always did), then from issued-off-stock (no warehouse
//    movement; recorded in `issuedWriteOff`). Anything past what is left comes
//    off the kit only, and an alert asks the office to review it.
//
//    Those reads happen after step 1 has locked the kit row, so a second
//    report for the same item sees the first one's rows.
//
// 3. RAN_OUT and OTHER reduce the kit only (RAN_OUT is flagged for a restock,
//    OTHER for review). For a tool, LOST sets MISSING and BROKEN sets DAMAGED,
//    with a review flag.
import "server-only";

import {
  conditionFlagType,
  ISSUE_LABEL,
  issueAuditReason,
  needsRestock,
  writesOffCompanyStock,
  type EquipmentCondition,
  type InventoryIssueType,
} from "@bookmops/core/inventory";

import type { ScopedTx } from "@/lib/db-scoped";
import { db } from "@/lib/org-db";
import { adjustWarehouseStock, pickSourceLocationId } from "@/lib/stock.server";

import type { Actor } from "../actor";
import { failure, notFound, ok, type Result } from "../result";
import { custodyLeft, splitWriteOff, type Custody } from "./custody";
import { NOT_IN_KIT, STOCK_TX } from "./kit";

/** The condition an issue puts a tool into; null leaves the condition alone. */
const ISSUE_CONDITION: Record<InventoryIssueType, EquipmentCondition | null> = {
  LOST: "MISSING",
  BROKEN: "DAMAGED",
  RAN_OUT: null,
  OTHER: null,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

class NotEnoughInKit extends Error {
  constructor(readonly have: number) {
    super("not enough in kit");
  }
}

type Tx = ScopedTx;

/** The custody totals for (cleaner, product), from the audit trail. */
export async function custodyOf(tx: Tx, employeeId: string, productId: string): Promise<Custody> {
  const [issued, stockWrittenOff, issuedWrittenOff] = await Promise.all([
    tx.inventoryChange.groupBy({
      by: ["action"],
      where: {
        employeeId,
        productId,
        action: { in: ["ASSIGN", "ADMIN_SET", "IMPORT", "PICKUP", "REQUEST_FULFILLED"] },
      },
      _sum: { quantityChange: true },
    }),
    // The warehouse side of this cleaner's own write-offs (employeeId null,
    // made by them, action ISSUE): negative quantities.
    tx.inventoryChange.aggregate({
      where: { employeeId: null, changedById: employeeId, productId, action: "ISSUE" },
      _sum: { quantityChange: true },
    }),
    tx.inventoryChange.aggregate({
      where: { employeeId, productId, action: "ISSUE" },
      _sum: { issuedWriteOff: true },
    }),
  ]);
  const sum = (actions: string[]) =>
    issued.filter((g) => g.action && actions.includes(g.action)).reduce((s, g) => s + (g._sum.quantityChange ?? 0), 0);
  return custodyLeft({
    issuedInPlace: sum(["ASSIGN", "ADMIN_SET", "IMPORT"]),
    issuedOffStock: sum(["PICKUP", "REQUEST_FULFILLED"]),
    stockWrittenOff: -(stockWrittenOff._sum.quantityChange ?? 0),
    issuedWrittenOff: issuedWrittenOff._sum.issuedWriteOff ?? 0,
  });
}

export interface ReportIssueInput {
  productId: string;
  type: InventoryIssueType;
  quantity: number;
  note?: string | null;
  now: Date;
}

export async function reportKitIssue(
  actor: Actor,
  input: ReportIssueInput,
): Promise<Result<{ productId: string; writtenOff: number; excess: number }>> {
  const qty = input.quantity;
  if (!Number.isInteger(qty) || qty <= 0) return failure(400, "VALIDATION_FAILED", "Quantity must be greater than zero");
  const issue = input.type;
  const reason = input.note?.trim().slice(0, 300) ?? "";

  const kit = await db.employeeProduct.findUnique({
    where: { employeeId_productId: { employeeId: actor.userId, productId: input.productId } },
    include: { product: { select: { name: true, unit: true, itemType: true } } },
  });
  if (!kit) return notFound(NOT_IN_KIT);

  const writeOff = writesOffCompanyStock(issue);
  const auditReason = issueAuditReason(issue, reason);
  const label = ISSUE_LABEL[issue];
  const isEquipment = kit.product.itemType === "REUSABLE_EQUIPMENT";
  const newCondition = isEquipment ? ISSUE_CONDITION[issue] : null;
  const flagType = newCondition ? conditionFlagType(newCondition) : null;
  const now = input.now;
  const who = { id: actor.userId, name: actor.name };

  try {
    const done = await db.$transaction(async (tx) => {
      // 1. The conditional decrement. Takes the row lock.
      const dec = await tx.employeeProduct.updateMany({
        where: { id: kit.id, employeeId: actor.userId, quantity: { gte: qty } },
        data: {
          quantity: { decrement: qty },
          ...(newCondition ? { condition: newCondition, statusUpdatedAt: now, statusNotes: reason || null } : {}),
        },
      });
      if (dec.count === 0) {
        const now2 = await tx.employeeProduct.findFirst({ where: { id: kit.id }, select: { quantity: true } });
        throw new NotEnoughInKit(now2?.quantity ?? 0);
      }
      const after = await tx.employeeProduct.findFirst({ where: { id: kit.id }, select: { quantity: true } });
      const newKitQty = after?.quantity ?? kit.quantity - qty;

      // 2. What of it is a write-off against company stock.
      let split = { fromStock: 0, fromIssued: 0, excess: 0 };
      if (writeOff) {
        split = splitWriteOff(qty, await custodyOf(tx, actor.userId, input.productId));
      }

      await tx.inventoryChange.create({
        data: {
          productId: input.productId,
          employeeId: actor.userId,
          employeeName: actor.name,
          quantityChange: -qty,
          newQuantity: newKitQty,
          unit: kit.product.unit,
          action: "ISSUE",
          previousStatus: newCondition ? (kit.condition ?? null) : null,
          newStatus: newCondition,
          reason: auditReason,
          issuedWriteOff: writeOff ? split.fromIssued : null,
          changedById: actor.userId,
          changedByName: actor.name,
        },
      });

      if (split.fromStock > 0) {
        const locationId = await pickSourceLocationId(tx, input.productId, split.fromStock);
        await adjustWarehouseStock(tx, {
          productId: input.productId,
          locationId,
          delta: -split.fromStock,
          action: "ISSUE",
          unit: kit.product.unit,
          reason: auditReason,
          actor: who,
        });
      }

      if (flagType) {
        const openFlag = await tx.inventoryFlag.findFirst({
          where: { employeeId: actor.userId, productId: input.productId, type: flagType, status: "OPEN" },
          select: { id: true },
        });
        if (openFlag) {
          await tx.inventoryFlag.update({ where: { id: openFlag.id }, data: { notes: reason || null } });
        } else {
          await tx.inventoryFlag.create({
            data: {
              type: flagType,
              employeeId: actor.userId,
              productId: input.productId,
              source: "ISSUE_REPORT",
              notes: reason || null,
            },
          });
        }
      }

      const covered = round2(split.fromStock + split.fromIssued);
      const tail = !writeOff
        ? needsRestock(issue)
          ? " Their kit has been reduced — they may need a restock."
          : " Their kit has been reduced; company stock is unchanged pending review."
        : split.excess > 0
          ? ` That is ${split.excess} more than the office issued to them, so ` +
            `${covered > 0 ? `only ${covered} was written off; the rest came off their kit only and needs review.` : "company stock is unchanged pending review."}`
          : split.fromStock > 0
            ? " Master stock and the cleaner's kit have both been decremented."
            : " The cleaner's kit has been decremented; this stock already left storage when it was picked up.";
      await tx.alert.create({
        data: {
          type: "LOW_INVENTORY",
          severity: needsRestock(issue) && split.excess === 0 ? "INFO" : "WARNING",
          title: `${label}: ${kit.product.name}`,
          message:
            `${actor.name ?? "A cleaner"} reported ${qty} ${kit.product.name} as ${label.toLowerCase()}.` +
            (reason ? ` Note: ${reason}` : "") +
            tail,
          relatedId: input.productId,
          relatedType: "Product",
          employeeId: actor.userId,
        },
      });
      return { writtenOff: covered, excess: split.excess };
    }, STOCK_TX);
    return ok({ productId: input.productId, ...done });
  } catch (e) {
    if (e instanceof NotEnoughInKit) {
      return failure(409, "NOT_ENOUGH_IN_KIT", `You only have ${e.have} of this item in your kit`);
    }
    throw e;
  }
}
