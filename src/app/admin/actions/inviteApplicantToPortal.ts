"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { sendApplicantInvite } from "@/lib/email";

const INVITE_TTL_DAYS = 7;

type InviteResult = { success: true; resent: boolean } | { error: string };

/**
 * Admin clicks "Invite to portal" on a JobApplication (decision D4). Mints a
 * restricted APPLICANT account — no password yet — and emails a set-password
 * invite link, following the same token shape as ClientCardSetupToken /
 * JobRatingToken (random token, expiry, single-use `usedAt`). Applications
 * with no invite keep behaving exactly as before (D4's explicit requirement)
 * — this action only ever ADDS a userId, never required by anything else.
 *
 * Calling it again on an already-invited application resends: mints a fresh
 * token for the same account rather than creating a second one.
 */
export async function inviteApplicantToPortal(applicationId: string): Promise<InviteResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" };
  }

  const app = await db.jobApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { error: "Application not found" };

  const email = app.email.trim().toLowerCase();
  if (!email) return { error: "Application has no email" };

  try {
    let userId: string;
    let resent = false;

    if (app.userId) {
      // Already invited (or converted) — resend for the same account.
      const existing = await db.user.findUnique({ where: { id: app.userId } });
      if (!existing) return { error: "Portal account not found" };
      if (existing.role !== "APPLICANT") {
        return {
          error: `This person already has a ${existing.role.toLowerCase()} account — no invite needed.`,
        };
      }
      userId = existing.id;
      resent = true;
    } else {
      const existingByEmail = await db.user.findFirst({ where: { email } });
      if (existingByEmail) {
        return {
          error: `An account already exists for this email (${existingByEmail.role.toLowerCase()}) — no invite needed.`,
        };
      }

      const created = await db.user.create({
        data: {
          name: app.name,
          email,
          phone: app.phone || null,
          role: "APPLICANT",
          isActive: true,
          // Set true when the invite is consumed — the click-through on a
          // link only they received stands in for verification (D4).
          emailVerified: false,
        },
      });
      await db.jobApplication.update({
        where: { id: applicationId },
        data: { userId: created.id },
      });
      userId = created.id;
    }

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    await db.applicantInviteToken.create({
      data: { userId, token, expiresAt },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const link = `${appUrl}/applicant-invite/${token}`;
    const result = await sendApplicantInvite({ to: email, applicantName: app.name, link });
    if (!result.ok) {
      return {
        error:
          ("error" in result && typeof result.error === "string" ? result.error : null) ??
          "Could not send invite email",
      };
    }

    revalidatePath("/admin/job-applications");
    return { success: true, resent };
  } catch (e) {
    console.error("inviteApplicantToPortal", e);
    return { error: "Failed to send portal invite" };
  }
}
