"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import { hashPassword, verifyPassword } from "better-auth/crypto";

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
      const existingUser = await db.user.findUnique({
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

    revalidatePath("/settings");
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

    // Get user's account with password (better-auth uses "credential" as providerId)
    const account = await db.account.findFirst({
      where: {
        userId: session.user.id,
        providerId: "credential",
      },
    });

    if (!account || !account.password) {
      return { success: false, error: "No password found for this account. You may be using a social login." };
    }

    // Verify current password using better-auth's password utilities (scrypt)
    const isValidPassword = await verifyPassword({
      password: currentPassword,
      hash: account.password,
    });

    if (!isValidPassword) {
      return { success: false, error: "Current password is incorrect" };
    }

    // Hash new password using better-auth's password utilities (scrypt)
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await db.account.update({
      where: { id: account.id },
      data: {
        password: hashedPassword,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error updating password:", error);
    return { success: false, error: "Failed to update password" };
  }
}

