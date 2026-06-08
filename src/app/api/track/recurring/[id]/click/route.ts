import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Click-tracking redirect for the save-offer button. Records the click, then
 * forwards the customer to the booking page (pre-filling the promo code).
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

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
