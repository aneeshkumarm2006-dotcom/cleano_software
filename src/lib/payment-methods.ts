import { db } from "@/db";

/**
 * Guards around removing a saved card.
 *
 * A client must not be left with no way to pay for work that is already booked
 * or still owing. Removing a card is the one payment-method action that can
 * silently break auto-charging later, so the check lives here and is applied by
 * BOTH the admin action and the customer-facing one — a rule enforced in only
 * one of the two surfaces is not enforced at all.
 *
 * Scope note: this implements "don't remove the ONLY card while something is
 * outstanding". The stricter rule — keeping a specific *previous* card until the
 * bookings it is attached to are settled — needs a per-booking card link that
 * the schema does not have yet (every charge path currently reads the client's
 * current default), so it is deliberately not attempted here.
 */

/**
 * Which card should this job be charged on?
 *
 * Prefers the card the booking was pinned to at confirmation, so replacing a
 * card doesn't retroactively move charges for work already booked. Falls back
 * to the client's current default when:
 *   - the job predates pinning (every existing row — `stripePaymentMethodId`
 *     was added nullable with no backfill, so the fallback reproduces the old
 *     behaviour exactly), or
 *   - the pinned card is no longer on file, in which case insisting on it would
 *     just fail the charge.
 *
 * Returns null when there is nothing to charge.
 */
export async function resolveChargePaymentMethod(opts: {
  clientId: string;
  pinnedPaymentMethodId: string | null;
  clientDefaultPaymentMethodId: string | null;
}): Promise<string | null> {
  if (opts.pinnedPaymentMethodId) {
    const stillOnFile = await db.clientPaymentMethod.findFirst({
      where: {
        clientId: opts.clientId,
        stripePaymentMethodId: opts.pinnedPaymentMethodId,
      },
      select: { id: true },
    });
    if (stillOnFile) return opts.pinnedPaymentMethodId;
  }
  return opts.clientDefaultPaymentMethodId;
}

/** Bookings still attached to a specific card — drives the admin "in use" flag. */
export async function countUpcomingBookingsOnCard(
  clientId: string,
  paymentMethodId: string
): Promise<number> {
  return db.job.count({
    where: {
      clientId,
      deletedAt: null,
      status: { notIn: ["CANCELLED"] },
      startTime: { gte: new Date() },
      stripePaymentMethodId: paymentMethodId,
    },
  });
}

export interface CardRemovalBlock {
  /** Bookings not yet in the past that still need a payment method. */
  upcomingCount: number;
  /** Past bookings still carrying an unsettled balance. */
  unsettledCount: number;
  /** Ready-to-display explanation, per the spec's "explain why" requirement. */
  message: string;
}

/** Counts the work that still needs a working card on file. */
export async function countBookingsNeedingPayment(clientId: string): Promise<{
  upcoming: number;
  unsettled: number;
}> {
  const now = new Date();

  const [upcoming, unsettled] = await Promise.all([
    db.job.count({
      where: {
        clientId,
        deletedAt: null,
        status: { notIn: ["CANCELLED"] },
        startTime: { gte: now },
      },
    }),
    db.job.count({
      where: {
        clientId,
        deletedAt: null,
        status: { in: ["IN_PROGRESS", "COMPLETED"] },
        paymentReceived: false,
      },
    }),
  ]);

  return { upcoming, unsettled };
}

/**
 * Returns a block when removing `paymentMethodId` would leave the client with
 * no saved card while bookings still need one. Returns null when removal is
 * fine.
 *
 * Card count is read from the local mirror, which `listClientPaymentMethods`
 * reconciles against Stripe — Stripe stays the system of record, this is just
 * the fastest correct read for a yes/no gate.
 */
export async function getCardRemovalBlock(
  clientId: string,
  paymentMethodId: string
): Promise<CardRemovalBlock | null> {
  // Bookings pinned to THIS card will charge THIS card, so it can't go until
  // they're completed or cancelled — even when other cards are on file.
  const attached = await countUpcomingBookingsOnCard(clientId, paymentMethodId);
  if (attached > 0) {
    return {
      upcomingCount: attached,
      unsettledCount: 0,
      message: `This card is connected to ${attached} upcoming booking${
        attached === 1 ? "" : "s"
      } and is what those bookings will be charged on. It can be removed once they're completed or cancelled.`,
    };
  }

  const remaining = await db.clientPaymentMethod.count({
    where: {
      clientId,
      stripePaymentMethodId: { not: paymentMethodId },
    },
  });

  // Another card is on file, so auto-charging survives this removal.
  if (remaining > 0) return null;

  const { upcoming, unsettled } = await countBookingsNeedingPayment(clientId);
  if (upcoming === 0 && unsettled === 0) return null;

  const parts: string[] = [];
  if (upcoming > 0) {
    parts.push(
      `${upcoming} upcoming booking${upcoming === 1 ? "" : "s"}`
    );
  }
  if (unsettled > 0) {
    parts.push(
      `${unsettled} booking${unsettled === 1 ? "" : "s"} with an outstanding balance`
    );
  }

  return {
    upcomingCount: upcoming,
    unsettledCount: unsettled,
    message: `This is the only payment method on file and it's connected to ${parts.join(
      " and "
    )}. Please add another card first — once a new payment method is saved, this one can be removed.`,
  };
}
