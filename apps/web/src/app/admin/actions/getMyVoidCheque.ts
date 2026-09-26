"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { myVoidCheque, type VoidChequeView } from "@/server/documents/documents";

/** What a cleaner is told about their own file on record. */
export type MyVoidCheque = VoidChequeView;

/**
 * The cleaner's current void cheque — METADATA ONLY, deliberately
 * (awerfixes.pdf item 16, decision 7).
 *
 * Decision 7 puts view/download behind an OWNER/ADMIN action that mints signed
 * URLs and logs the access. Handing the cleaner a second, unlogged minting path
 * would quietly reopen what that decision closed, so this returns the filename
 * and date — enough to answer "did my upload land, and is it the right file?" —
 * and the page offers Replace rather than View.
 *
 * Self-scoped: the employee id comes from the session, never from a parameter.
 * The read lives in server/documents/documents.ts, shared with the phone's
 * GET /api/v1/documents.
 */
export async function getMyVoidCheque(): Promise<MyVoidCheque | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;
    return await myVoidCheque(
      actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
    );
  } catch (error) {
    console.error("Error reading void cheque:", error);
    return null;
  }
}
