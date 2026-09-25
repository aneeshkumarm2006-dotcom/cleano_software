"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { hashPassword } from "better-auth/crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { sendAccountEmail } from "@/lib/email";
import { checkCleanerSeats, takesASeat } from "@/lib/plan-limits";

type HireResult =
  | { success: true; existing: true }
  | { success: true; converted: true; userId: string }
  | { success: true; existing: false; tempPassword: string }
  | { error: string };

/** Readable 12-char temp password (no ambiguous chars). */
function makeTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * APP-002/004: hire an applicant → mark HIRED and provision a cleaner login.
 *
 * Three paths, in order (decision D4 — "Hire" becomes "Convert"):
 *   1. The application already has a portal account (an admin used "Invite
 *      to portal" at some point) — CONVERT it: flip APPLICANT → EMPLOYEE in
 *      place. No new login, no temp password — they already set their own
 *      password when they activated the portal. The admin still needs to
 *      assign pay tier / service categories / availability / documents on
 *      the employee profile; the caller links there rather than this action
 *      rebuilding those surfaces.
 *   2. No portal account, but a User already exists with that email (e.g.
 *      hired once before) — reactivate it, exactly as before D4.
 *   3. No portal account and no existing User — create a fresh EMPLOYEE
 *      account with a generated temp password, exactly as before D4. This is
 *      the "applicants without an invite behave exactly as today" guarantee.
 */
export async function hireApplicant(applicationId: string): Promise<HireResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" };
  }

  const app = await db.jobApplication.findUnique({ where: { id: applicationId } });
  if (!app) return { error: "Application not found" };

  try {
    // Path 1 — a portal account exists (D4's "Invite to portal" was used).
    if (app.userId) {
      const portalUser = await db.user.findUnique({ where: { id: app.userId } });
      if (portalUser) {
        const isApplicant = portalUser.role === "APPLICANT";

        // Hiring is not the only way to use a seat. An applicant becoming a
        // cleaner, or a deactivated cleaner being switched back on, each take
        // one — and neither reads like "create". Compare before and after.
        if (
          takesASeat(portalUser, {
            role: isApplicant ? "EMPLOYEE" : portalUser.role,
            isActive: true,
          })
        ) {
          const seats = await checkCleanerSeats(1);
          if (!seats.ok) return { error: seats.message };
        }

        await db.user.update({
          where: { id: portalUser.id },
          data: {
            isActive: true,
            // Only an APPLICANT gets converted — a portal user who is already
            // staff (e.g. converted once before) keeps their real role.
            ...(isApplicant ? { role: "EMPLOYEE" } : {}),
          },
        });
        await db.jobApplication.update({
          where: { id: applicationId },
          data: { status: "HIRED" },
        });
        revalidatePath("/admin/job-applications");
        revalidatePath("/admin/employees");
        revalidatePath(`/admin/employees/${portalUser.id}`);

        if (isApplicant) {
          return { success: true, converted: true, userId: portalUser.id };
        }
        return { success: true, existing: true };
      }
      // userId pointed at a User row that no longer exists (soft-deleted?) —
      // fall through to the email-based path rather than failing the action.
    }

    const email = app.email.trim().toLowerCase();
    if (!email) return { error: "Application has no email" };

    // Path 2 — no portal account, but a User already exists for this email.
    const existingUser = await db.user.findFirst({ where: { email } });
    if (existingUser) {
      if (takesASeat(existingUser, { role: existingUser.role, isActive: true })) {
        const seats = await checkCleanerSeats(1);
        if (!seats.ok) return { error: seats.message };
      }
      // Reactivate / ensure they can work; don't downgrade an admin/owner role.
      await db.user.update({
        where: { id: existingUser.id },
        data: { isActive: true },
      });
      await db.jobApplication.update({
        where: { id: applicationId },
        data: { status: "HIRED" },
      });
      revalidatePath("/admin/job-applications");
      revalidatePath("/admin/employees");
      return { success: true, existing: true };
    }

    // Path 3 — brand new hire, no invite was ever sent.
    const seats = await checkCleanerSeats(1);
    if (!seats.ok) return { error: seats.message };

    const tempPassword = makeTempPassword();
    const hashed = await hashPassword(tempPassword);

    const user = await db.user.create({
      data: {
        name: app.name,
        email,
        phone: app.phone || null,
        emailVerified: true,
        isActive: true,
        role: "EMPLOYEE",
      },
    });
    await db.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashed,
      },
    });

    await db.jobApplication.update({
      where: { id: applicationId },
      data: { status: "HIRED" },
    });

    // Provider welcome emails (gated by Settings → Notifications).
    sendAccountEmail({ to: email, name: app.name, role: "PROVIDER", event: "new_account" }).catch(
      (e) => console.error("hire new_account email", e)
    );
    sendAccountEmail({ to: email, name: app.name, role: "PROVIDER", event: "how_it_works" }).catch(
      (e) => console.error("hire how_it_works email", e)
    );
    sendAccountEmail({ to: email, name: app.name, role: "PROVIDER", event: "activated" }).catch(
      (e) => console.error("hire activated email", e)
    );

    revalidatePath("/admin/job-applications");
    revalidatePath("/admin/employees");
    return { success: true, existing: false, tempPassword };
  } catch (e) {
    console.error("hireApplicant", e);
    return { error: "Failed to hire applicant" };
  }
}
