"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { randomBytes } from "crypto";

interface CreateInput {
  jobId: string;
  cleanerId?: string | null;
  expiresInDays?: number;
}

// Mints a single-use rating token for a job. Called automatically after a
// payment receipt is sent, or manually by an admin from the job detail page.
export async function createRatingToken(input: CreateInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    if (!input.jobId) return { success: false, error: "Missing jobId" };

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays ?? 30));

    // Capture the customer so the portal rating pop-up can find this token.
    const job = await db.job.findUnique({
      where: { id: input.jobId },
      select: { clientId: true },
    });

    const row = await db.jobRatingToken.create({
      data: {
        jobId: input.jobId,
        cleanerId: input.cleanerId ?? null,
        customerId: job?.clientId ?? null,
        token,
        expiresAt,
      },
    });

    return { success: true, token: row.token, expiresAt };
  } catch (error) {
    console.error("Error creating rating token:", error);
    return { success: false, error: "Failed to create rating link" };
  }
}
