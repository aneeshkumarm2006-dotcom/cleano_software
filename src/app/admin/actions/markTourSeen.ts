"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/org-db";

/**
 * Record that this person has finished or dismissed the guided tour.
 *
 * Stamped on the USER, not in their browser. localStorage made this a fact
 * about a device: the same owner saw the tour again on their phone, and again
 * after clearing site data. Whether somebody has been shown the introduction is
 * a fact about the somebody.
 *
 * No role check, deliberately. The worst a caller can do with this is stop
 * themselves being offered a tour, and the tour can always be reopened from the
 * dashboard button — so there is nothing here worth guarding beyond "is anyone
 * signed in", and `session.user.id` means it can only ever write its own row.
 *
 * Failure is swallowed by design. This fires as the overlay closes, and a
 * database hiccup must not put an error in front of somebody who has just
 * dismissed something. The cost of losing the write is that the tour offers
 * itself once more.
 */
export async function markTourSeen(): Promise<{ ok: boolean }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return { ok: false };

    await db.user.update({
      where: { id: session.user.id },
      data: { tourSeenAt: new Date() },
    });
    return { ok: true };
  } catch (error) {
    console.error("markTourSeen", error);
    return { ok: false };
  }
}
