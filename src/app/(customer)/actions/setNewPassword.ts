"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { hashPassword } from "better-auth/crypto";
import { sendAccountEmail } from "@/lib/email";

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

    await db.user.update({ where: { id: userId }, data: { mustChangePassword: false } });

    // Confirmation email — gated by the existing `cust.account.password_changed` row.
    sendAccountEmail({
      to: session.user.email,
      name: session.user.name ?? session.user.email,
      role: "CUSTOMER",
      event: "password_changed",
    }).catch((e) => console.error("password_changed email", e));

    return { success: true };
  } catch (e) {
    console.error("setNewPassword", e);
    return { success: false, error: "Couldn't update your password. Please try again." };
  }
}
