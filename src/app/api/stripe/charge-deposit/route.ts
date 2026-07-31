import { NextRequest, NextResponse } from "next/server";
import {
  stripe,
  getOrCreateStripeCustomer,
  BOOKING_DEPOSIT_CENTS,
  BOOKING_DEPOSIT_CURRENCY,
} from "@/lib/stripe";
import { db } from "@/db";

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json();

    if (!email || !name) {
      return NextResponse.json({ error: "email and name are required" }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const client = await db.client.findFirst({ where: { email: normalizedEmail } });

    let customerId: string;
    if (client) {
      customerId = await getOrCreateStripeCustomer(client.id, normalizedEmail, name);
    } else {
      const customer = await stripe.customers.create({ email: normalizedEmail, name });
      customerId = customer.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: BOOKING_DEPOSIT_CENTS,
      currency: BOOKING_DEPOSIT_CURRENCY,
      customer: customerId,
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true },
      description: "Cleano booking deposit",
      // `submitBooking` re-reads this metadata to prove the intent it is handed
      // is genuinely a booking deposit for THIS email — not a gift-card,
      // job-charge or cancellation-fee intent replayed from elsewhere, and not
      // one paid against somebody else's email. `type` is kept alongside the
      // newer `kind` so intents already in flight during a deploy still verify.
      metadata: {
        type: "deposit",
        kind: "booking_deposit",
        email: normalizedEmail,
      },
    });

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      customerId,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    console.error("charge-deposit error:", err);
    return NextResponse.json(
      { error: "Failed to start deposit payment" },
      { status: 500 }
    );
  }
}
