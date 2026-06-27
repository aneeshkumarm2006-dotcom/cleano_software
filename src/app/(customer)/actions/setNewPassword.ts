"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { hashPassword } from "better-auth/crypto";
import { sendAccountEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity-log";
import { notifyAdmins } from "@/lib/admin-alerts";
import { isCleanerRole } from "@/lib/role-routing";

/**
 * Sets a new password for the signed-in customer and clears the
 * `mustChangePassword` flag. Used by the forced first-login reset that
 * imported (temp-password) accounts go through. No current-password check —
 * the user is already authenticated, and the flow exists precisely to retire
 * the shared temp password.
 */
export async function setNewPassword(input: {
  password: string;
  confirm: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const password = input.password ?? "";
    if (password.length < 8)
      return { success: false, error: "Password must be at least 8 characters." };
    if (password !== input.confirm)
      return { success: false, error: "Passwords don't match." };

    const userId = session.user.id;
    const hashed = await hashPassword(password);

    const account = await db.account.findFirst({
      where: { userId, providerId: "credential" },
      select: { id: true },
    });
    if (account) {
      await db.account.update({ where: { id: account.id }, data: { password: hashed } });
    } else {
      await db.account.create({
        data: { userId, accountId: userId, providerId: "credential", password: hashed },
      });
    }

    // Setting a fresh hash above already retires the temporary password;
    // clearing the flag completes the deactivation so it can never be reused.
    await db.user.update({ where: { id: userId }, data: { mustChangePassword: false } });

    const role = (session.user as { role?: string }).role;
    const isCleaner = isCleanerRole(role);
    const name = session.user.name ?? session.user.email;

    // Confirmation email to the user (role-aware: cleaner vs customer template).
    sendAccountEmail({
      to: session.user.email,
      name,
      role: isCleaner ? "PROVIDER" : "CUSTOMER",
      event: "password_changed",
    }).catch((e) => console.error("password_changed email", e));

    // Audit log + admin notification (event only — never the password).
    await logActivity({
      category: "AUTH",
      action: "password_changed",
      status: "SUCCESS",
      actorId: userId,
      actorLabel: session.user.email,
      message: `${name} set a new password (temporary password deactivated).`,
    });
    await notifyAdmins({
      title: `Password set — ${name}`,
      message: `${isCleaner ? "Cleaner" : "Customer"} ${name} <${session.user.email}> set their own password; the temporary password is now deactivated.`,
      relatedId: userId,
      relatedType: "User",
    });

    return { success: true };
  } catch (e) {
    console.error("setNewPassword", e);
    return { success: false, error: "Couldn't update your password. Please try again." };
  }
}
