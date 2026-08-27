import { NextRequest, NextResponse } from "next/server";
import { BOOKING_DEPOSIT_CURRENCY } from "@/lib/stripe";

import { getOrCreateStripeCustomer, requireStripeForCurrentOrg } from "@/lib/stripe-org";
import { db } from "@/lib/org-db";
import { depositIntentKind, isQuotedService } from "@/lib/booking-deposit";
import { StripeNotConfigured, stripeForCurrentOrg } from "@/lib/stripe-org";
import { resolveDepositCentsForService } from "@/lib/booking-deposit.server";

export async function POST(req: NextRequest) {
  try {
    const { email, name, serviceType } = await req.json();

    if (!email || !name) {
      return NextResponse.json({ error: "email and name are required" }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    // ── The amount is resolved HERE, from the service type, and never taken
    // from the request body (PDF #9, Stage 11).
    //
    // `serviceType` IS accepted from the client, because the browser is the only
    // thing that knows what the customer picked — but it is a *selector*, not a
    // price. It can only ever move the deposit between two server-side figures
    // ($20 or the configured post-construction amount), and `submitBooking`
    // re-resolves the same figure from the service type it actually books and
    // refuses an intent that captured less. So the worst a tampered value can do
    // is create a $20 intent for a post-construction booking that then fails
    // verification — never a booking that under-paid.
    const requestedService =
      typeof serviceType === "string" ? serviceType : null;
    const amount = await resolveDepositCentsForService(requestedService);

    // A workspace can set its deposit to zero, and then there is nothing to
    // charge and no card to collect. Answered here rather than by creating a
    // zero-value PaymentIntent, which Stripe refuses anyway.
    if (amount <= 0) {
      return NextResponse.json({
        depositWaived: true,
        clientSecret: null,
        customerId: null,
        paymentIntentId: null,
        amount: 0,
        amountUsd: 0,
      });
    }

    // A deposit is due but this workspace has no Stripe account. Say so in
    // words the customer's screen can show. Falling back to the platform's own
    // account is what this whole change exists to prevent — that is somebody
    // else's bank — and a 500 would just read as "the site is broken".
    const configured = await stripeForCurrentOrg();
    if (!configured.ok) {
      return NextResponse.json(
        {
          error: new StripeNotConfigured(configured.reason).message,
          code: "STRIPE_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const client = await db.client.findFirst({ where: { email: normalizedEmail } });

    let customerId: string;
    if (client) {
      customerId = await getOrCreateStripeCustomer(client.id, normalizedEmail, name);
    } else {
      const customer = await (await requireStripeForCurrentOrg()).customers.create({ email: normalizedEmail, name });
      customerId = customer.id;
    }

    const paymentIntent = await (await requireStripeForCurrentOrg()).paymentIntents.create({
      amount,
      currency: BOOKING_DEPOSIT_CURRENCY,
      customer: customerId,
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true },
      description: isQuotedService(requestedService)
        ? "Cleano post-construction quote deposit"
        : "Cleano booking deposit",
      // `submitBooking` re-reads this metadata to prove the intent it is handed
      // is genuinely a booking deposit for THIS email — not a gift-card,
      // job-charge or cancellation-fee intent replayed from elsewhere, and not
      // one paid against somebody else's email. `type` is kept alongside the
      // newer `kind` so intents already in flight during a deploy still verify.
      //
      // `kind` is "pc_deposit" for post-construction and "booking_deposit"
      // otherwise (Stage 11). Both are accepted as deposits — the kind is a
      // label for reporting and refund reconciliation, NOT the amount check;
      // that is `amount_received` against the server-resolved figure.
      metadata: {
        type: "deposit",
        kind: depositIntentKind(requestedService),
        email: normalizedEmail,
        serviceType: requestedService ?? "",
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      customerId,
      paymentIntentId: paymentIntent.id,
      // Echoed back so the review step can print the deposit it is about to
      // charge instead of a hardcoded "$20". Display only — the number that
      // matters is the one the intent was created with, above.
      amount,
      amountUsd: amount / 100,
    });
  } catch (err) {
    console.error("charge-deposit error:", err);
    return NextResponse.json(
      { error: "Failed to start deposit payment" },
      { status: 500 }
    );
  }
}
