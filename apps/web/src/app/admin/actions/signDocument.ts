"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { actorFromSession } from "@/server/actor";
import { signDocumentFor } from "@/server/documents/documents";
import { revalidateAfterSign } from "@/server/documents/revalidate";
import { fireEffects } from "@/server/effects";

interface SignDocumentInput {
  documentId: string;
  /** The version and content hash the page showed. */
  version: string;
  contentSha256: string;
  /** The "I have read and agree" box. */
  agreed: boolean;
  /** The strokes drawn on the pad, as the phone sends them (DrawnSignature). */
  signature: unknown;
}

/**
 * Sign a document assigned to the caller. The rules live in
 * server/documents/documents.ts, shared with the phone's
 * POST /api/v1/documents/:id/sign.
 *
 * What changed from the old action: the page sends the pad's STROKES, not a
 * picture of them, and the server draws the stored image itself; the version
 * and content hash shown are echoed and must still be current; the agreement
 * tick is checked on the server; and an EXPIRED document can no longer be
 * signed (the page already said so). The signature now also keeps the
 * version, hash, consent sentence and User-Agent beside the IP.
 */
export async function signDocument(input: SignDocumentInput) {
  try {
    const hdrs = await headers();
    const session = await auth.api.getSession({ headers: hdrs });
    if (!session) return { success: false, error: "Not authenticated" };

    if (!input?.documentId || typeof input.documentId !== "string") {
      return { success: false, error: "Document id is required" };
    }
    if (typeof input.version !== "string" || typeof input.contentSha256 !== "string") {
      return { success: false, error: "Reload the page and try again." };
    }

    const ip =
      hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip")?.trim() || null;
    const result = await signDocumentFor(
      actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
      {
        documentId: input.documentId,
        version: input.version.slice(0, 32),
        contentSha256: input.contentSha256.slice(0, 64),
        agreed: input.agreed === true,
        signature: input.signature,
        ip,
        userAgent: hdrs.get("user-agent"),
        now: new Date(),
      },
    );
    if (!result.ok) return { success: false, error: result.message };

    fireEffects(result.effects);
    revalidateAfterSign(input.documentId);
    return { success: true };
  } catch (error) {
    console.error("Error signing document:", error);
    return { success: false, error: "Failed to sign document" };
  }
}
