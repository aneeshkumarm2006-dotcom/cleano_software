"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { sendRecurringSaveOffer } from "@/lib/email";
import {
  getSaveOfferConfig,
  RECURRING_FREQUENCIES,
  SAVE_OFFER_COOLDOWN_DAYS,
  saveOfferLabel,
} from "@/lib/retention";
import { logContactCancellation, logContactEvent } from "@/lib/crm";

interface Input {
  reason?: string;
  /** Admin-only: cancel on behalf of a specific client. */
  clientId?: string;
}

/**
 * Cancel a customer's ENTIRE recurring service (distinct from cancelling a
 * single cleaning). Records the cancellation, downgrades the client to
 * one-time, flags upcoming visits for admin review, and — unless a save offer
 * was already sent within the cooldown — emails a check-in + save offer.
 */
export async function cancelRecurringService(input: Input = {}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const role = (session.user as { role?: string }).role;
    const isAdmin = role === "OWNER" || role === "ADMIN";

    // Resolve the target client: admin may pass a clientId; otherwise the
    // logged-in customer cancels their own service.
    let client;
    if (input.clientId && isAdmin) {
      client = await db.client.findUnique({ where: { id: input.clientId } });
    } else {
      const email = session.user.email?.toLowerCase();
      client = email ? await db.client.findFirst({ where: { email } }) : null;
    }
    if (!client) return { success: false, error: "Client not found" };

    const isRecurring =
      !!client.serviceFrequency &&
      (RECURRING_FREQUENCIES as readonly string[]).includes(client.serviceFrequency);
    if (!isRecurring) {
      return { success: false, error: "You don't have an active recurring service." };
    }

    const now = new Date();

    // Cooldown: don't send another save offer if one went out recently.
    const cooldownStart = new Date(
      now.getTime() - SAVE_OFFER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    );
    const recentOffer = await db.recurringCancellation.findFirst({
      where: { clientId: client.id, emailSentAt: { gte: cooldownStart } },
      orderBy: { emailSentAt: "desc" },
    });
    const withinCooldown = !!recentOffer;

    const config = await getSaveOfferConfig();
    const makeOffer = config.enabled && !withinCooldown;

    // Generate a one-time promo code for the offer.
    let offerCode: string | null = null;
    if (makeOffer) {
      offerCode = `BACK-${randomBytes(3).toString("hex").toUpperCase()}`;
      const expiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      await db.promoCode.create({
        data: {
          code: offerCode,
          description: `Win-back offer for ${client.name}`,
          discountType: config.offerType,
          discountValue: config.offerValue,
          maxUses: 1,
          expiresAt,
          isActive: true,
        },
      });
    }

    // Record the cancellation.
    const cancellation = await db.recurringCancellation.create({
      data: {
        clientId: client.id,
        frequency: client.serviceFrequency,
        reason: input.reason?.trim() || null,
        cancelledAt: now,
        offerType: makeOffer ? config.offerType : null,
        offerValue: makeOffer ? config.offerValue : null,
        offerCode,
        offerStatus: withinCooldown ? "NONE" : "PENDING",
      },
    });

    // Downgrade to one-time and flag upcoming visits for admin review.
    await db.client.update({
      where: { id: client.id },
      data: { serviceFrequency: "ONE_TIME" },
    });
    await db.job.updateMany({
      where: {
        clientId: client.id,
        status: { in: ["CREATED", "SCHEDULED"] },
        startTime: { gte: now },
        cancellationRequestedAt: null,
      },
      data: { cancellationRequestedAt: now },
    });

    // §7: log the recurring-plan cancellation on the CRM timeline (no downgrade).
    await logContactCancellation(client.id, "Recurring plan cancelled by customer");

    // Send the check-in + save offer (unless within cooldown).
    if (!withinCooldown && client.email) {
      const label =
        makeOffer ? saveOfferLabel(config) : null;
      const result = await sendRecurringSaveOffer({
        to: client.email,
        clientName: client.name,
        cancellationId: cancellation.id,
        intro: config.emailIntro,
        offerLabel: label,
        offerCode,
      });
      await db.recurringCancellation.update({
        where: { id: cancellation.id },
        data: {
          emailSentAt: new Date(),
          offerStatus: result.ok ? "SENT" : "PENDING",
        },
      });
      // §11: log the win-back offer on the CRM contact timeline.
      if (result.ok && makeOffer && label) {
        await logContactEvent(
          client.id,
          "EMAIL",
          "Win-back offer sent",
          `${label}${offerCode ? ` — code ${offerCode}` : ""}`
        );
      }
      await db.emailLog
        .create({
          data: {
            kind: "OTHER",
            recipient: client.email,
            subject: "Recurring cancellation — save offer",
            status: result.ok ? "SENT" : "FAILED",
            sentAt: result.ok ? new Date() : null,
          },
        })
        .catch(() => {});
    }

    revalidatePath("/portal");
    revalidatePath("/portal/bookings");
    revalidatePath(`/clients/${client.id}`);

    return {
      success: true,
      offerSent: !withinCooldown && !!client.email,
      withinCooldown,
    };
  } catch (error) {
    console.error("Error cancelling recurring service:", error);
    return { success: false, error: "Failed to cancel recurring service" };
  }
}
