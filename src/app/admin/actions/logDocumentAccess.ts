"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const ALLOWED_ACTIONS = ["OPEN", "VIEW", "DOWNLOAD", "COMPLETE"] as const;
type AccessAction = (typeof ALLOWED_ACTIONS)[number];

// Item 20: record real document activity. Best-effort by design — a failed
// log write returns success:false but callers never block the user on it.
export async function logDocumentAccess(documentId: string, action: AccessAction) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false };
  if (!documentId || !ALLOWED_ACTIONS.includes(action)) return { success: false };

  try {
    await db.documentAccessLog.create({
      data: { documentId, userId: session.user.id, action },
    });
    return { success: true };
  } catch (e) {
    console.error("logDocumentAccess", e);
    return { success: false };
  }
}
