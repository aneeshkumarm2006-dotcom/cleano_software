import { NextRequest, NextResponse } from "next/server";

import {
  StripeNotConfigured,
  getOrCreateStripeCustomer,
  requireStripeForCurrentOrg,
} from "@/lib/stripe-org";
import { db } from "@/lib/org-db";
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
      const customer = await (await requireStripeForCurrentOrg()).customers.create({ email, name });
      customerId = customer.id;
    }

    const setupIntent = await (await requireStripeForCurrentOrg()).setupIntents.create({
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

    /**
     * Say what actually went wrong.
     *
     * This used to answer every failure with "Failed to create setup intent",
     * which is the one thing the admin already knew. The commonest cause since
     * the workspace cutover is simply that this company has no Stripe key yet —
     * each workspace now carries its own, where there used to be one global key
     * — and `StripeNotConfigured` already says so in a sentence that names the
     * page to fix it on. Swallowing that turned a two-click settings task into
     * an unexplained error.
     *
     * Stripe's own messages are written for humans and carry no secrets ("No
     * such customer", "Your card was declined"), so they are passed through
     * too. Anything else stays generic — an unrecognised error is exactly the
     * kind that might carry internals — and every case is logged above either
     * way.
     */
    if (err instanceof StripeNotConfigured) {
      return NextResponse.json(
        { error: err.message, code: err.reason },
        { status: 409 }
      );
    }
    const stripeMessage =
      typeof err === "object" &&
      err !== null &&
      typeof (err as { type?: unknown }).type === "string" &&
      (err as { type: string }).type.startsWith("Stripe") &&
      typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : null;

    return NextResponse.json(
      { error: stripeMessage ?? "Failed to create setup intent" },
      { status: 500 }
    );
  }
}
