import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/org-db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 1×1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/** Email open-tracking pixel for a recurring save-offer email. */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  try {
    const row = await db.recurringCancellation.findUnique({
      where: { id },
      select: { id: true, openedAt: true, offerStatus: true },
    });
    if (row && !row.openedAt) {
      await db.recurringCancellation.update({
        where: { id },
        data: {
          openedAt: new Date(),
          // Only advance the funnel; never downgrade clicked/replied/redeemed.
          ...(row.offerStatus === "SENT" || row.offerStatus === "PENDING"
            ? { offerStatus: "OPENED" }
            : {}),
        },
      });
    }
  } catch {
    /* tracking must never break image rendering */
  }
  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
