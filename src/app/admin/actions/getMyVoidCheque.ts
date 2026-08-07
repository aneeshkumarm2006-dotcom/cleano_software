"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { VOID_CHEQUE_KIND } from "@/lib/employee-files";

/** What a cleaner is told about their own file on record. */
export interface MyVoidCheque {
  fileName: string;
  mimeType: string;
  uploadedAt: string;
}

/**
 * The cleaner's current void cheque — METADATA ONLY, deliberately
 * (awerfixes.pdf item 16, decision 7).
 *
 * Decision 7 puts view/download behind an OWNER/ADMIN action that mints signed
 * URLs and logs the access. Handing the cleaner a second, unlogged minting path
 * would quietly reopen what that decision closed, so this returns the filename
 * and date — enough to answer "did my upload land, and is it the right file?" —
 * and the page offers Replace rather than View. If the owner later wants
 * self-view, it is one signed-URL call added here, with the same logging.
 *
 * Self-scoped: the employee id comes from the session, never from a parameter.
 */
export async function getMyVoidCheque(): Promise<MyVoidCheque | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;

    const row = await db.employeeFile.findFirst({
      where: { employeeId: session.user.id, kind: VOID_CHEQUE_KIND },
      // Newest row is the current one — the table is append-only.
      orderBy: { uploadedAt: "desc" },
      select: { fileName: true, mimeType: true, uploadedAt: true },
    });
    if (!row) return null;

    return {
      fileName: row.fileName,
      mimeType: row.mimeType,
      uploadedAt: row.uploadedAt.toISOString(),
    };
  } catch (error) {
    console.error("Error reading void cheque:", error);
    return null;
  }
}
