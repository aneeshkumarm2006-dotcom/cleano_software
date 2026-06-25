"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { randomBytes } from "crypto";
import { sendAccountEmail } from "@/lib/email";

/**
 * Admin action: mint a one-time token tied to a client, email the
 * customer a link to /add-card/[token] where they enter their card via
 * Stripe Elements. On success the card is saved to
 * `Client.defaultPaymentMethodId` so future charges run off-session.
 *
 * Token lives for 7 days. Old unused tokens for the same client are
 * left alone — admin can resend safely.
 */
export async function sendAddCardLink(input: {
  jobId: string;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  const job = await db.job.findUnique({
    where: { id: input.jobId },
    include: { client: true },
  });
  if (!job) return { success: false, error: "Job not found" };
  if (!job.client) {
    return { success: false, error: "Job has no linked client" };
  }
  if (!job.client.email) {
    return { success: false, error: "Client has no email on file" };
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.clientCardSetupToken.create({
    data: {
      clientId: job.client.id,
      jobId: job.id,
      token,
      expiresAt,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const link = `${appUrl}/add-card/${token}`;

  const result = await sendAccountEmail({
    to: job.client.email,
    name: job.client.name,
    role: "CUSTOMER",
    event: "add_card",
    link,
  });

  if (!result.ok) {
    return {
      success: false,
      error:
        ("error" in result && typeof result.error === "string"
          ? result.error
          : null) ?? "Could not send email",
    };
  }

  return { success: true, expiresAt: expiresAt.toISOString() };
}
