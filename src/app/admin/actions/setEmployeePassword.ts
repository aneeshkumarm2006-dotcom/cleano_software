"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { hashPassword } from "better-auth/crypto";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity-log";
import { makeTempPassword } from "@/lib/bookingkoala/core";

/**
 * Admin sets/resets a staff member's (cleaner's) password from the UI. The
 * admin either types a value or lets us generate a strong one; we return the
 * value so the admin can hand it over. We NEVER reveal an existing password
 * (one-way hashed) — this replaces it. Event is audit-logged; the password
 * itself is never stored in plaintext or logged.
 */
export async function setEmployeePassword(input: {
  userId: string;
  password?: string;
}): Promise<{ success: true; password: string } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }
  if (!input.userId) return { success: false, error: "Missing user" };

  const target = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, name: true, email: true },
  });
  if (!target) return { success: false, error: "User not found" };

  let password = (input.password ?? "").trim();
  if (password) {
    if (password.length < 8) {
      return { success: false, error: "Password must be at least 8 characters." };
    }
  } else {
    password = makeTempPassword();
  }

  try {
    const hashed = await hashPassword(password);
    const account = await db.account.findFirst({
      where: { userId: target.id, providerId: "credential" },
      select: { id: true },
    });
    if (account) {
      await db.account.update({ where: { id: account.id }, data: { password: hashed } });
    } else {
      await db.account.create({
        data: { userId: target.id, accountId: target.id, providerId: "credential", password: hashed },
      });
    }

    // Admin-set a known password to hand over → clear the forced-reset flag so
    // it stays active (don't force the cleaner to immediately change it).
    await db.user.update({ where: { id: target.id }, data: { mustChangePassword: false } });

    await logActivity({
      category: "AUTH",
      action: "admin_set_password",
      status: "SUCCESS",
      actorId: session!.user.id,
      actorLabel: session!.user.email,
      message: `Admin set a new password for ${target.name} <${target.email}>.`,
    });

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${target.id}`);
    return { success: true, password };
  } catch (e) {
    console.error("setEmployeePassword", e);
    return { success: false, error: "Failed to set password" };
  }
}
