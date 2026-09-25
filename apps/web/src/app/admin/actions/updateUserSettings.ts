"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { endOtherSessions } from "@/lib/session-revocation";
import { verifyAndSetPassword } from "@/server/account/password";

interface UpdateUserSettingsParams {
  name: string;
  email: string;
  phone: string | null;
}

interface UpdateUserPasswordParams {
  currentPassword: string;
  newPassword: string;
}

export async function updateUserSettings(params: UpdateUserSettingsParams) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    const { name, email, phone } = params;

    // Check if email is already taken by another user
    if (email !== session.user.email) {
      const existingUser = await db.user.findFirst({
        where: { email },
      });

      if (existingUser && existingUser.id !== session.user.id) {
        return { success: false, error: "Email is already in use" };
      }
    }

    // Update user information
    await db.user.update({
      where: { id: session.user.id },
      data: {
        name,
        email,
        phone: phone || null,
      },
    });

    revalidatePath("/admin/settings");
    revalidatePath("/");

    return { success: true };
  } catch (error) {
    console.error("Error updating user settings:", error);
    return { success: false, error: "Failed to update settings" };
  }
}

export async function updateUserPassword(params: UpdateUserPasswordParams) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session) {
      return { success: false, error: "Not authenticated" };
    }

    const { currentPassword, newPassword } = params;

    // Check the current password and store the new one (scrypt, via
    // better-auth's utilities). Shared with the phone's change-password
    // endpoint; the messages are this form's own.
    const set = await verifyAndSetPassword(session.user.id, currentPassword, newPassword);
    if (!set.ok) return { success: false, error: set.message };

    // Anyone else signed in with the old password is signed out; this device
    // stays signed in.
    await endOtherSessions(session.user.id, session.session.token);

    return { success: true };
  } catch (error) {
    console.error("Error updating password:", error);
    return { success: false, error: "Failed to update password" };
  }
}

