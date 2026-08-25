"use server";

import { db } from "@/lib/org-db";
import { hashPassword } from "better-auth/crypto";
import { logActivity } from "@/lib/activity-log";
import { notifyAdmins } from "@/lib/admin-alerts";

type ConsumeResult = { success: true } | { success: false; error: string };

/**
 * Consumes an ApplicantInviteToken (decision D4): sets the applicant's own
 * password and marks the account email-verified. The click-through on a link
 * only they received (emailed to the address on their application) stands in
 * for email verification — same convention as the rest of this app's
 * staff-created accounts (see hireApplicant.ts).
 *
 * Re-validates the token server-side even though the page already checked it,
 * the same defense-in-depth `finalizeCardSetup.ts` uses for ClientCardSetupToken.
 */
export async function consumeApplicantInvite(input: {
  token: string;
  password: string;
  confirm: string;
}): Promise<ConsumeResult> {
  const token = input.token?.trim();
  if (!token) return { success: false, error: "Invalid link" };

  if (!input.password || input.password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters" };
  }
  if (input.password !== input.confirm) {
    return { success: false, error: "Passwords don't match" };
  }

  const row = await db.applicantInviteToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!row) return { success: false, error: "This link is not valid." };
  if (row.usedAt) {
    return {
      success: false,
      error: "This link has already been used. Ask your contact for a new invite.",
    };
  }
  if (row.expiresAt < new Date()) {
    return {
      success: false,
      error: "This link has expired. Ask your contact to resend the invite.",
    };
  }

  try {
    const hashed = await hashPassword(input.password);

    await db.$transaction(async (tx) => {
      const existingAccount = await tx.account.findFirst({
        where: { userId: row.userId, providerId: "credential" },
        select: { id: true },
      });
      if (existingAccount) {
        await tx.account.update({
          where: { id: existingAccount.id },
          data: { password: hashed },
        });
      } else {
        await tx.account.create({
          data: {
            userId: row.userId,
            accountId: row.userId,
            providerId: "credential",
            password: hashed,
          },
        });
      }
      await tx.user.update({
        where: { id: row.userId },
        data: { emailVerified: true },
      });
      await tx.applicantInviteToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
    });

    await logActivity({
      category: "AUTH",
      action: "applicant_activated",
      status: "SUCCESS",
      actorId: row.userId,
      actorLabel: row.user.email,
      message: `Applicant portal account activated for ${row.user.name}`,
    });
    notifyAdmins({
      title: `Applicant portal activated — ${row.user.name}`,
      message: `${row.user.name} <${row.user.email}> set their password and can now sign in to the applicant portal.`,
      relatedId: row.userId,
      relatedType: "User",
    }).catch((e) => console.error("applicant activated admin alert", e));

    return { success: true };
  } catch (e) {
    console.error("consumeApplicantInvite", e);
    return { success: false, error: "Couldn't set your password. Please try again." };
  }
}
