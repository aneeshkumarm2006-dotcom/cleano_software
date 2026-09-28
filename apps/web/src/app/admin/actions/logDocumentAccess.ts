"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { DOCUMENT_ACCESS_ACTIONS, logDocumentAccessFor, type DocumentAccessAction } from "@/server/documents/documents";

// Item 20: record real document activity. Best-effort by design — a failed
// log write returns success:false but callers never block the user on it.
//
// Shared with the phone's POST /api/v1/documents/:id/access
// (server/documents/documents.ts). Stricter than before: the document must be
// assigned to the caller, and COMPLETE is written only by signing.
export async function logDocumentAccess(documentId: string, action: DocumentAccessAction) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false };
  if (!documentId || typeof documentId !== "string" || !DOCUMENT_ACCESS_ACTIONS.includes(action)) {
    return { success: false };
  }

  try {
    const result = await logDocumentAccessFor(
      actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
      documentId,
      action,
    );
    return { success: result.ok && result.value.logged };
  } catch (e) {
    console.error("logDocumentAccess", e);
    return { success: false };
  }
}
