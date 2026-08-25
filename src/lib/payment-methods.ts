import { db } from "@/lib/org-db";
import { STORE_TZ } from "@/lib/timezone";

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

/**
 * Tell admins a client's default card was replaced before an upcoming job
 * (CLN-P1-7-09, the third of "fails, expires, or is replaced").
 *
 * "Replaced" is a *change of default from one card to another*, which is the
 * one event that changes what gets charged. It therefore covers all three ways
 * that happens — a new card added (which auto-defaults), a different saved card
 * chosen, or the newest remaining card promoted after the default was removed —
 * and deliberately excludes a client's FIRST card, which replaces nothing.
 *
 * Every default-changing path calls this, rather than each one deciding for
 * itself, so the admin surface, the customer account, the emailed add-card link
 * and the Stripe webhook can't drift apart on when this fires.
 *
 * Never throws: a notification must not be able to fail a card operation that
 * has already been committed to Stripe.
 */
export async function notifyCardReplaced(opts: {
  clientId: string;
  previousDefaultPaymentMethodId: string | null;
  newDefaultPaymentMethodId: string;
  /** Plain-words explanation of how the change happened, for the email body. */
  reason: string;
}): Promise<void> {
  try {
    // A first card replaces nothing, and re-confirming the same card is not a
    // change at all.
    if (!opts.previousDefaultPaymentMethodId) return;
    if (opts.previousDefaultPaymentMethodId === opts.newDefaultPaymentMethodId)
      return;

    const client = await db.client.findUnique({
      where: { id: opts.clientId },
      select: { id: true, name: true },
    });
    if (!client) return;

    // "…before an upcoming job": a client with nothing booked has nothing at
    // risk, and admins don't need the noise.
    const upcoming = await db.job.findMany({
      where: {
        clientId: opts.clientId,
        deletedAt: null,
        status: { notIn: ["CANCELLED"] },
        startTime: { gte: new Date() },
      },
      orderBy: { startTime: "asc" },
      select: { jobNumber: true, startTime: true },
    });
    if (upcoming.length === 0) return;

    // One notice per card that becomes the default. Without this, a customer
    // toggling between two saved cards would mail every admin on each toggle.
    const already = await db.emailLog.findFirst({
      where: {
        notificationKey: "admin.card.replaced",
        providerId: opts.newDefaultPaymentMethodId,
        recipient: "admins",
        status: { in: ["SENT", "PENDING", "FAILED"] },
      },
      select: { id: true },
    });
    if (already) return;
    const log = await db.emailLog.create({
      data: {
        kind: "OTHER",
        notificationKey: "admin.card.replaced",
        recipient: "admins",
        subject: "admin.card.replaced",
        status: "PENDING",
        providerId: opts.newDefaultPaymentMethodId,
      },
      select: { id: true },
    });

    const [newCard, oldCard] = await Promise.all([
      db.clientPaymentMethod.findFirst({
        where: {
          clientId: opts.clientId,
          stripePaymentMethodId: opts.newDefaultPaymentMethodId,
        },
        select: { brand: true, last4: true },
      }),
      db.clientPaymentMethod.findFirst({
        where: {
          clientId: opts.clientId,
          stripePaymentMethodId: opts.previousDefaultPaymentMethodId,
        },
        select: { brand: true, last4: true },
      }),
    ]);

    const next = upcoming[0];
    // Imported lazily: email.ts pulls in Resend and the whole template set, and
    // this module is imported by charge paths that must stay light.
    const { sendAdminCardReplaced } = await import("@/lib/email");
    try {
      await sendAdminCardReplaced({
        clientId: client.id,
        clientName: client.name,
        newBrand: newCard?.brand ?? null,
        newLast4: newCard?.last4 ?? null,
        // The old card's mirror row is already gone when the replacement came
        // from a removal, so this is best-effort by design.
        oldBrand: oldCard?.brand ?? null,
        oldLast4: oldCard?.last4 ?? null,
        reason: opts.reason,
        upcomingBookings: upcoming.length,
        nextJobNumber: next.jobNumber,
        nextJobDateLabel: next.startTime.toLocaleDateString("en-CA", {
          weekday: "long",
          month: "long",
          day: "numeric",
          timeZone: STORE_TZ,
        }),
      });
      await db.emailLog.update({
        where: { id: log.id },
        data: { status: "SENT" },
      });
    } catch (e) {
      console.error("notifyCardReplaced send", opts.clientId, e);
      await db.emailLog
        .update({ where: { id: log.id }, data: { status: "FAILED" } })
        .catch(() => {});
    }
  } catch (e) {
    console.error("notifyCardReplaced", opts.clientId, e);
  }
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
