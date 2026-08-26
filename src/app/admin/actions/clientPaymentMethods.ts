"use server";

import { db } from "@/lib/org-db";
import { stripe } from "@/lib/stripe";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { logActivity } from "@/lib/activity-log";
import { getCardRemovalBlock, notifyCardReplaced } from "@/lib/payment-methods";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { sendAccountEmail } from "@/lib/email";
import type { ClientPaymentMethod } from "@prisma/client";
import type {
  ClientPaymentMethodDTO,
  ListClientPaymentMethodsResult,
} from "./clientPaymentMethods.types";
import { currentAppUrl } from "@/lib/org-url";

// Multiple saved cards per client.
//
// Stripe is the system of record for the cards themselves; `ClientPaymentMethod`
// is a display mirror (brand / last4 / expiry) so the admin UI does not have to
// hit Stripe on every render, and `Client.defaultPaymentMethodId` stays the one
// field every charge path already reads (chargeJob, bulkChargeJobs,
// cardHoldActions, markNoShow, requestCancellation).
//
// NO RAW CARD DATA is ever accepted, stored or logged here — cards only ever
// enter the system through Stripe Elements (SetupIntent), so this module only
// ever sees `pm_…` ids and the display metadata Stripe hands back.

const MAX_CARDS = 20;
/** Re-sending an add-card link inside this window returns the existing token. */
const ADD_CARD_LINK_COOLDOWN_MS = 60 * 1000;
const ADD_CARD_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isExpired(expMonth: number | null, expYear: number | null): boolean {
  if (!expMonth || !expYear) return false;
  const now = new Date();
  const endOfMonth = new Date(expYear, expMonth, 1); // first of the NEXT month
  return endOfMonth.getTime() <= now.getTime();
}

function toDTO(
  row: ClientPaymentMethod,
  upcomingBookings = 0
): ClientPaymentMethodDTO {
  return {
    id: row.id,
    stripePaymentMethodId: row.stripePaymentMethodId,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.expMonth,
    expYear: row.expYear,
    isDefault: row.isDefault,
    label: row.label,
    isExpired: isExpired(row.expMonth, row.expYear),
    upcomingBookings,
  };
}

/**
 * How many upcoming bookings each of these cards is pinned to, in one grouped
 * query rather than a count per card.
 */
async function upcomingBookingsByCard(
  clientId: string
): Promise<Map<string, number>> {
  const rows = await db.job.groupBy({
    by: ["stripePaymentMethodId"],
    where: {
      clientId,
      deletedAt: null,
      status: { notIn: ["CANCELLED"] },
      startTime: { gte: new Date() },
      stripePaymentMethodId: { not: null },
    },
    _count: { _all: true },
  });
  return new Map(
    rows
      .filter((r) => r.stripePaymentMethodId)
      .map((r) => [r.stripePaymentMethodId as string, r._count._all])
  );
}

/** Loads the client, or fails closed. OWNER/ADMIN only. */
async function loadClient(clientId: unknown) {
  const gate = await requireOwnerAdmin();
  if (!gate.ok) return { ok: false as const, error: gate.error };

  if (typeof clientId !== "string" || !clientId) {
    return { ok: false as const, error: "Invalid client" };
  }

  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      stripeCustomerId: true,
      defaultPaymentMethodId: true,
    },
  });
  if (!client) return { ok: false as const, error: "Client not found" };
  // The actor rides along so every mutation below can name WHO did it in the
  // payment-method history (admin activity log).
  return { ok: true as const, client, actorId: gate.userId, actorRole: gate.role };
}

/**
 * Payment-method history. Every add / default-change / removal / add-card-link
 * is recorded against the client so admin can answer "when was this card added,
 * made default, or replaced, and by whom".
 *
 * Card identity is keyed on the Stripe `pm_` id, never the local mirror row id —
 * `listClientPaymentMethods` deletes and recreates mirror rows when it syncs, so
 * a mirror id would dangle. Only brand/last4/expiry are ever recorded; the PAN
 * and CVV never reach this server.
 */
async function logCardActivity(opts: {
  actorId: string;
  actorRole: string;
  clientId: string;
  clientName: string;
  action: string;
  message: string;
  paymentMethodId: string | null;
  status?: "SUCCESS" | "FAILED";
  card?: { brand: string | null; last4: string | null } | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await logActivity({
    category: "PAYMENT",
    action: opts.action,
    status: opts.status ?? "SUCCESS",
    actorId: opts.actorId,
    actorLabel: opts.actorRole,
    targetType: "Client",
    targetId: opts.clientId,
    message: opts.message,
    providerId: opts.paymentMethodId,
    metadata: {
      clientName: opts.clientName,
      paymentMethodId: opts.paymentMethodId,
      ...(opts.card
        ? { cardBrand: opts.card.brand, cardLast4: opts.card.last4 }
        : {}),
      ...(opts.extra ?? {}),
    },
  });
}

/**
 * IDOR guard. A payment-method id is client-supplied, so before acting on it we
 * prove it belongs to THIS client's Stripe customer — first via our own mirror,
 * then confirmed against Stripe itself (the mirror could be stale).
 */
async function assertOwnedCard(
  clientId: string,
  stripeCustomerId: string | null,
  paymentMethodId: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (
    typeof paymentMethodId !== "string" ||
    !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId)
  ) {
    return { ok: false, error: "Invalid card" };
  }
  if (!stripeCustomerId) return { ok: false, error: "Card not found" };

  let pm;
  try {
    pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  } catch {
    return { ok: false, error: "Card not found" };
  }

  const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (!owner || owner !== stripeCustomerId) {
    // Belongs to a different customer (or is unattached) — deny, and make sure
    // no stale mirror row keeps claiming it for this client.
    await db.clientPaymentMethod
      .deleteMany({ where: { clientId, stripePaymentMethodId: paymentMethodId } })
      .catch(() => {});
    return { ok: false, error: "Card not found" };
  }
  return { ok: true };
}

/**
 * List the client's saved cards, syncing from Stripe (the system of record) into
 * the local mirror. Falls back to the mirror if Stripe is unreachable.
 */
export async function listClientPaymentMethods(
  clientId: string
): Promise<
  | ({ success: true } & ListClientPaymentMethodsResult)
  | { success: false; error: string }
> {
  const gate = await loadClient(clientId);
  if (!gate.ok) return { success: false, error: gate.error };
  const { client } = gate;

  if (!client.stripeCustomerId) {
    // No Stripe customer yet ⇒ no cards can exist. Clear any orphan mirror rows.
    await db.clientPaymentMethod
      .deleteMany({ where: { clientId: client.id } })
      .catch(() => {});
    return { success: true, methods: [], synced: true, hasStripeCustomer: false };
  }

  try {
    const list = await stripe.paymentMethods.list({
      customer: client.stripeCustomerId,
      type: "card",
      limit: MAX_CARDS,
    });

    const liveIds = list.data.map((pm) => pm.id);
    // The stored default is only meaningful if the card still exists in Stripe.
    const defaultId =
      client.defaultPaymentMethodId &&
      liveIds.includes(client.defaultPaymentMethodId)
        ? client.defaultPaymentMethodId
        : null;

    for (const pm of list.data) {
      const data = {
        clientId: client.id,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: pm.id === defaultId,
      };
      await db.clientPaymentMethod.upsert({
        where: { stripePaymentMethodId: pm.id },
        update: data,
        create: { ...data, stripePaymentMethodId: pm.id },
      });
    }

    // Drop mirror rows for cards detached outside this UI (Stripe dashboard,
    // customer portal). `notIn: []` is a no-op filter in Prisma, so an empty
    // Stripe list correctly clears every row for this client.
    await db.clientPaymentMethod.deleteMany({
      where: { clientId: client.id, stripePaymentMethodId: { notIn: liveIds } },
    });

    // Self-heal a dangling default so charges don't fail against a dead card.
    if (client.defaultPaymentMethodId && !defaultId) {
      await db.client.update({
        where: { id: client.id },
        data: { defaultPaymentMethodId: null },
      });
    }

    const rows = await db.clientPaymentMethod.findMany({
      where: { clientId: client.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    const pinned = await upcomingBookingsByCard(client.id);
    return {
      success: true,
      methods: rows.map((r) =>
        toDTO(r, pinned.get(r.stripePaymentMethodId) ?? 0)
      ),
      synced: true,
      hasStripeCustomer: true,
    };
  } catch (error) {
    console.error("listClientPaymentMethods: Stripe sync failed", error);
    const rows = await db.clientPaymentMethod.findMany({
      where: { clientId: client.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    const pinned = await upcomingBookingsByCard(client.id);
    return {
      success: true,
      methods: rows.map((r) =>
        toDTO(r, pinned.get(r.stripePaymentMethodId) ?? 0)
      ),
      synced: false,
      hasStripeCustomer: true,
    };
  }
}

/**
 * Make a saved card the default. Updates BOTH `Client.defaultPaymentMethodId`
 * (what every charge path reads) and the `isDefault` mirror flags, plus the
 * Stripe customer's invoice default so off-session charges agree.
 */
export async function setDefaultClientPaymentMethod(input: {
  clientId: string;
  paymentMethodId: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const gate = await loadClient(input?.clientId);
  if (!gate.ok) return { success: false, error: gate.error };
  const { client, actorId, actorRole } = gate;

  const owned = await assertOwnedCard(
    client.id,
    client.stripeCustomerId,
    input?.paymentMethodId
  );
  if (!owned.ok) return { success: false, error: owned.error };
  const paymentMethodId = input.paymentMethodId;

  const previousDefault = client.defaultPaymentMethodId;
  const card = await db.clientPaymentMethod.findFirst({
    where: { clientId: client.id, stripePaymentMethodId: paymentMethodId },
    select: { brand: true, last4: true },
  });

  try {
    await stripe.customers.update(client.stripeCustomerId!, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    await db.$transaction([
      db.clientPaymentMethod.updateMany({
        where: { clientId: client.id },
        data: { isDefault: false },
      }),
      db.clientPaymentMethod.updateMany({
        where: { clientId: client.id, stripePaymentMethodId: paymentMethodId },
        data: { isDefault: true },
      }),
      db.client.update({
        where: { id: client.id },
        data: { defaultPaymentMethodId: paymentMethodId },
      }),
    ]);

    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.set_default",
      message: `Made ${card?.brand ?? "card"} •••• ${card?.last4 ?? "????"} the default payment method for ${client.name}.`,
      paymentMethodId,
      card,
      extra: { previousDefaultPaymentMethodId: previousDefault },
    });

    await notifyCardReplaced({
      clientId: client.id,
      previousDefaultPaymentMethodId: previousDefault,
      newDefaultPaymentMethodId: paymentMethodId,
      reason: `An admin made a different saved card the default for ${client.name}.`,
    });

    revalidatePath(`/admin/clients/${client.id}`);
    revalidatePath("/admin/jobs");
    return { success: true };
  } catch (error) {
    console.error("setDefaultClientPaymentMethod failed", error);
    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.set_default",
      status: "FAILED",
      message: `Failed to make ${card?.brand ?? "card"} •••• ${card?.last4 ?? "????"} the default for ${client.name}.`,
      paymentMethodId,
      card,
    });
    return { success: false, error: "Could not set that card as default" };
  }
}

/**
 * Detach a saved card from the client. If it was the default, the newest
 * remaining card is promoted so auto-charging doesn't silently break; if it was
 * the last card, the default is cleared and the caller gets a warning.
 */
export async function removeClientPaymentMethod(input: {
  clientId: string;
  paymentMethodId: string;
}): Promise<
  | { success: true; warning: string | null }
  | { success: false; error: string }
> {
  const gate = await loadClient(input?.clientId);
  if (!gate.ok) return { success: false, error: gate.error };
  const { client, actorId, actorRole } = gate;

  const owned = await assertOwnedCard(
    client.id,
    client.stripeCustomerId,
    input?.paymentMethodId
  );
  if (!owned.ok) return { success: false, error: owned.error };
  const paymentMethodId = input.paymentMethodId;

  // Read the card's identity BEFORE the mirror row is deleted, so the history
  // entry can still name which card was removed.
  const card = await db.clientPaymentMethod.findFirst({
    where: { clientId: client.id, stripePaymentMethodId: paymentMethodId },
    select: { brand: true, last4: true },
  });
  const wasDefault = client.defaultPaymentMethodId === paymentMethodId;

  // Don't strip the last card off a client who still has work booked or owing —
  // that silently disables auto-charging. Previously this only produced a
  // warning AFTER the card was already detached.
  const block = await getCardRemovalBlock(client.id, paymentMethodId);
  if (block) {
    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.remove_blocked",
      status: "FAILED",
      message: `Blocked removal of ${card?.brand ?? "card"} •••• ${card?.last4 ?? "????"} for ${client.name}: ${block.message}`,
      paymentMethodId,
      card,
      extra: {
        upcomingCount: block.upcomingCount,
        unsettledCount: block.unsettledCount,
      },
    });
    return { success: false, error: block.message };
  }

  try {
    try {
      await stripe.paymentMethods.detach(paymentMethodId);
    } catch (err) {
      // Already detached in Stripe — keep going so the local mirror converges
      // (idempotent remove). Anything else is a real failure.
      const code = (err as { code?: string })?.code;
      if (code !== "resource_missing") throw err;
    }

    await db.clientPaymentMethod.deleteMany({
      where: { clientId: client.id, stripePaymentMethodId: paymentMethodId },
    });

    let warning: string | null = null;

    if (client.defaultPaymentMethodId === paymentMethodId) {
      const next = await db.clientPaymentMethod.findFirst({
        where: { clientId: client.id },
        orderBy: { createdAt: "desc" },
      });

      if (next) {
        await stripe.customers.update(client.stripeCustomerId!, {
          invoice_settings: {
            default_payment_method: next.stripePaymentMethodId,
          },
        });
        await db.$transaction([
          db.clientPaymentMethod.updateMany({
            where: { clientId: client.id },
            data: { isDefault: false },
          }),
          db.clientPaymentMethod.update({
            where: { id: next.id },
            data: { isDefault: true },
          }),
          db.client.update({
            where: { id: client.id },
            data: { defaultPaymentMethodId: next.stripePaymentMethodId },
          }),
        ]);
        warning = `Removed the default card — ${next.brand ?? "card"} •••• ${next.last4 ?? "????"} is now the default.`;
        await notifyCardReplaced({
          clientId: client.id,
          previousDefaultPaymentMethodId: paymentMethodId,
          newDefaultPaymentMethodId: next.stripePaymentMethodId,
          reason: `An admin removed ${client.name}'s default card, so the newest remaining card was promoted.`,
        });
      } else {
        await db.client.update({
          where: { id: client.id },
          data: { defaultPaymentMethodId: null },
        });
        warning =
          "That was the client's only card. Jobs for this client can no longer be auto-charged until a new card is added.";
      }
    }

    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.removed",
      message: `Removed ${card?.brand ?? "card"} •••• ${card?.last4 ?? "????"} from ${client.name}.${warning ? ` ${warning}` : ""}`,
      paymentMethodId,
      card,
      extra: {
        wasDefault,
        // What the client is left with, so the history explains why later
        // charges moved to a different card (or stopped).
        replacementDefaultPaymentMethodId: wasDefault
          ? ((
              await db.client.findUnique({
                where: { id: client.id },
                select: { defaultPaymentMethodId: true },
              })
            )?.defaultPaymentMethodId ?? null)
          : client.defaultPaymentMethodId,
        leftWithNoCard: warning?.includes("only card") ?? false,
      },
    });

    revalidatePath(`/admin/clients/${client.id}`);
    revalidatePath("/admin/jobs");
    return { success: true, warning };
  } catch (error) {
    console.error("removeClientPaymentMethod failed", error);
    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.removed",
      status: "FAILED",
      message: `Failed to remove ${card?.brand ?? "card"} •••• ${card?.last4 ?? "????"} from ${client.name}.`,
      paymentMethodId,
      card,
      extra: { wasDefault },
    });
    return { success: false, error: "Could not remove that card" };
  }
}

/**
 * Email the client a one-time link to /add-card/[token] where they enter a card
 * via Stripe Elements — same flow as the job-detail "Send add card link", but
 * scoped to the client profile (no job needed).
 *
 * Rate-limit: a fresh, unused token minted in the last minute is reused instead
 * of issuing another, so a double-click (or a spam attempt) can't fan out mail.
 */
export async function sendClientAddCardLink(
  clientId: string
): Promise<
  { success: true; expiresAt: string } | { success: false; error: string }
> {
  const gate = await loadClient(clientId);
  if (!gate.ok) return { success: false, error: gate.error };
  const { client, actorId, actorRole } = gate;

  if (!client.email) {
    return { success: false, error: "Client has no email on file" };
  }

  try {
    const recent = await db.clientCardSetupToken.findFirst({
      where: {
        clientId: client.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
        createdAt: { gt: new Date(Date.now() - ADD_CARD_LINK_COOLDOWN_MS) },
      },
      orderBy: { createdAt: "desc" },
    });

    const token = recent?.token ?? randomBytes(24).toString("base64url");
    const expiresAt =
      recent?.expiresAt ?? new Date(Date.now() + ADD_CARD_LINK_TTL_MS);

    if (!recent) {
      await db.clientCardSetupToken.create({
        data: { clientId: client.id, token, expiresAt },
      });
    }

    const appUrl = await currentAppUrl();
    const result = await sendAccountEmail({
      to: client.email,
      name: client.name,
      role: "CUSTOMER",
      event: "add_card",
      link: `${appUrl}/add-card/${token}`,
    });

    if (!result.ok) {
      // Detail stays in the server log; the admin gets a generic message.
      console.error("sendClientAddCardLink: email failed", result);
      await logCardActivity({
        actorId,
        actorRole,
        clientId: client.id,
        clientName: client.name,
        action: "card.add_link_sent",
        status: "FAILED",
        message: `Failed to email an add-card link to ${client.name}.`,
        paymentMethodId: null,
      });
      return { success: false, error: "Could not send the email" };
    }

    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.add_link_sent",
      message: `Emailed ${client.name} a one-time link to add a payment method.`,
      paymentMethodId: null,
      // `reused` distinguishes a fresh mint from the cooldown re-send, so the
      // history doesn't read as if two separate links went out.
      extra: { expiresAt: expiresAt.toISOString(), reused: !!recent },
    });

    return { success: true, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    console.error("sendClientAddCardLink failed", error);
    await logCardActivity({
      actorId,
      actorRole,
      clientId: client.id,
      clientName: client.name,
      action: "card.add_link_sent",
      status: "FAILED",
      message: `Failed to email an add-card link to ${client.name}.`,
      paymentMethodId: null,
    });
    return { success: false, error: "Could not send the email" };
  }
}
