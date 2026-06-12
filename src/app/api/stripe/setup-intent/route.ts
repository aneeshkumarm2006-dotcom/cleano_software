import { NextRequest, NextResponse } from "next/server";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import { isAdminRole } from "@/lib/role-routing";

export async function POST(req: NextRequest) {
  try {
    // Admin-only. This binds a SetupIntent to a specific client (by clientId),
    // so it must require staff — otherwise anyone could attach a card to any
    // client's Stripe customer (IDOR). The public booking flow uses
    // /api/stripe/charge-deposit instead, which never takes a clientId.
    const session = await auth.api.getSession({ headers: req.headers });
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!isAdminRole(role)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 401 });
    }

    const { email, name, clientId } = await req.json();

    if (!email || !name) {
      return NextResponse.json({ error: "email and name are required" }, { status: 400 });
    }

    // Find or create client record to get/set stripeCustomerId
    let resolvedClientId = clientId;
    if (!resolvedClientId) {
      const client = await db.client.findFirst({ where: { email: email.toLowerCase() } });
      resolvedClientId = client?.id;
    }

    let customerId: string;
    if (resolvedClientId) {
      customerId = await getOrCreateStripeCustomer(resolvedClientId, email, name);
    } else {
      // Guest — create a temporary customer, will be linked after booking
      const customer = await stripe.customers.create({ email, name });
      customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId,
    });
  } catch (err) {
    console.error("setup-intent error:", err);
    return NextResponse.json(
      { error: "Failed to create setup intent" },
      { status: 500 }
    );
  }
}
