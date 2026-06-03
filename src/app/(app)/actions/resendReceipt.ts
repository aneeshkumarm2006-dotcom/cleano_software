"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { queueAndSendReceipt } from "@/lib/email";

/** Admin action: re-fire the customer receipt email for an already-paid job. */
export async function resendReceipt(jobId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }
  try {
    await queueAndSendReceipt(jobId);
    return { success: true };
  } catch (err) {
    const msg =
      (err as { message?: string })?.message ?? "Could not resend receipt";
    return { success: false, error: msg };
  }
}
