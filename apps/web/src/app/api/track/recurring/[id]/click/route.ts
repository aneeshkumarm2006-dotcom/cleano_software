import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/org-db";
import { requestOrigin } from "@/lib/org-url";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Click-tracking redirect for the save-offer button. Records the click, then
 * forwards the customer to the booking page (pre-filling the promo code).
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  // The customer is already on their cleaning company's own address — they got
  // here by clicking a link in that company's email — so forward them within it.
  // Reading a configured domain instead would bounce a second tenant's customer
  // onto the first tenant's booking page.
  //
  // From the Host header, not from `req.url`: Next does not guarantee the URL a
  // route handler sees carries the public host, and taking the origin from it
  // is precisely what broke sign-in in /api/post-signin — the redirect went to
  // the server's own address, where the visitor's session does not exist.
  const appUrl = await requestOrigin(new URL(req.url).origin);

  let dest = `${appUrl}/book`;
  try {
    const row = await db.recurringCancellation.findUnique({
      where: { id },
      select: { offerCode: true, clickedAt: true, offerStatus: true },
    });
    if (row) {
      if (row.offerCode) dest = `${appUrl}/book?promo=${encodeURIComponent(row.offerCode)}`;
      const advance =
        row.offerStatus === "SENT" ||
        row.offerStatus === "OPENED" ||
        row.offerStatus === "PENDING";
      await db.recurringCancellation.update({
        where: { id },
        data: {
          ...(row.clickedAt ? {} : { clickedAt: new Date() }),
          ...(advance ? { offerStatus: "CLICKED" } : {}),
        },
      });
    }
  } catch {
    /* fall through to the booking page even if tracking fails */
  }
  return NextResponse.redirect(dest, { status: 302 });
}
