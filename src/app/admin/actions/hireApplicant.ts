"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { hashPassword } from "better-auth/crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { sendAccountEmail } from "@/lib/email";

type HireResult =
  | { success: true; existing: true }
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
 * APP-002/004: hire an applicant → mark HIRED and provision a cleaner account.
 * - Existing user with that email → reactivate it (no new account).
 * - Otherwise → create an EMPLOYEE account (auto-verified, active) with a
 *   generated temp password returned for the admin to share, and send the
 *   provider welcome emails. (Email-based set-password invites are a future
 *   refinement — the app has no cleaner password-reset flow yet.)
 */
export async function hireApplicant(applicationId: string): Promise<HireResult> {
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
    const existingUser = await db.user.findUnique({ where: { email } });

    if (existingUser) {
      // Reactivate / ensure they can work; don't downgrade an admin/owner role.
      await db.user.update({
        where: { id: existingUser.id },
        data: {
          isActive: true,
          ...(existingUser.role === "EMPLOYEE" ? {} : {}),
        },
      });
      await db.jobApplication.update({
        where: { id: applicationId },
        data: { status: "HIRED" },
      });
      revalidatePath("/admin/job-applications");
      revalidatePath("/admin/employees");
      return { success: true, existing: true };
    }

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
