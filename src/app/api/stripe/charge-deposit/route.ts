import { NextRequest, NextResponse } from "next/server";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { db } from "@/db";

export async function POST(req: NextRequest) {
  try {
    const { email, name } = await req.json();

    if (!email || !name) {
      return NextResponse.json({ error: "email and name are required" }, { status: 400 });
    }

    const client = await db.client.findFirst({ where: { email: email.toLowerCase() } });

    let customerId: string;
    if (client) {
      customerId = await getOrCreateStripeCustomer(client.id, email, name);
    } else {
      const customer = await stripe.customers.create({ email, name });
      customerId = customer.id;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2000, // $20.00 CAD
      currency: "cad",
      customer: customerId,
      setup_future_usage: "off_session",
      automatic_payment_methods: { enabled: true },
      description: "Cleano booking deposit",
      metadata: { type: "deposit" },
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
