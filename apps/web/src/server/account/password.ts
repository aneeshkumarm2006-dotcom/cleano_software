// Changing your own password.
//
// `verifyAndSetPassword` is the check-and-write the web's settings form has
// always done (app/admin/actions/updateUserSettings.ts updateUserPassword,
// now a thin adapter over it). `changeOwnPassword` is the phone's
// POST /api/v1/me/password, which adds what its contract promises:
//
//   - the current password is always required, so a stolen session alone
//     can't lock the owner out;
//   - it clears a pending forced change (mustChangePassword), and when it
//     does, the office is told as the web's forced-change form tells it;
//   - every OTHER session ends; this device stays signed in;
//   - the person gets the usual "password changed" email.
import "server-only";

import { hashPassword, verifyPassword } from "better-auth/crypto";

import { logActivity } from "@/lib/activity-log";
import { notifyAdmins } from "@/lib/admin-alerts";
import { sendAccountEmail } from "@/lib/email";
import { db } from "@/lib/org-db";
import { isCleanerRole } from "@/lib/role-routing";
import { endOtherSessions } from "@/lib/session-revocation";

import type { Actor } from "../actor";
import { effect } from "../effects";
import { failure, ok, type Result } from "../result";

/** Check the current password and store the new one. The web's messages, word for word. */
export async function verifyAndSetPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<Result<null>> {
  // better-auth keeps the password on the "credential" account.
  const account = await db.account.findFirst({
    where: { userId, providerId: "credential" },
  });
  if (!account || !account.password) {
    return failure(409, "NO_PASSWORD", "No password found for this account. You may be using a social login.");
  }

  const isValidPassword = await verifyPassword({ password: currentPassword, hash: account.password });
  if (!isValidPassword) {
    return failure(400, "WRONG_PASSWORD", "Current password is incorrect");
  }

  const hashedPassword = await hashPassword(newPassword);
  await db.account.update({ where: { id: account.id }, data: { password: hashedPassword } });
  return ok(null);
}

export async function changeOwnPassword(
  actor: Actor,
  input: { currentPassword: string; newPassword: string; keepSessionToken: string },
): Promise<Result<{ ok: true }>> {
  if (input.newPassword === input.currentPassword) {
    return failure(400, "SAME_PASSWORD", "Choose a password different from the current one.");
  }
  const person = await db.user.findUnique({
    where: { id: actor.userId },
    select: { mustChangePassword: true },
  });
  if (!person) return failure(404, "NOT_FOUND", "This account isn't available.");

  const set = await verifyAndSetPassword(actor.userId, input.currentPassword, input.newPassword);
  if (!set.ok) return set;

  if (person.mustChangePassword) {
    await db.user.update({ where: { id: actor.userId }, data: { mustChangePassword: false } });
  }
  // Whoever else was signed in with the old password is signed out.
  await endOtherSessions(actor.userId, input.keepSessionToken);

  const name = actor.name ?? actor.email;
  const isCleaner = isCleanerRole(actor.role);
  const effects = [
    effect("password_changed email", () =>
      sendAccountEmail({
        to: actor.email,
        name,
        role: actor.role === "CLIENT" ? "CUSTOMER" : "PROVIDER",
        event: "password_changed",
      }),
    ),
  ];
  if (person.mustChangePassword) {
    // Audit + office notice (the event only — never the password), as the
    // web's forced-change form does.
    effects.push(
      effect("password_changed activity", () =>
        logActivity({
          category: "AUTH",
          action: "password_changed",
          status: "SUCCESS",
          actorId: actor.userId,
          actorLabel: actor.email,
          message: `${name} set a new password (temporary password deactivated).`,
        }),
      ),
      effect("password_changed admin notice", () =>
        notifyAdmins({
          title: `Password set — ${name}`,
          message: `${isCleaner ? "Cleaner" : "Staff member"} ${name} <${actor.email}> set their own password from the app; the temporary password is now deactivated.`,
          relatedId: actor.userId,
          relatedType: "User",
        }),
      ),
    );
  }
  return ok({ ok: true as const }, effects);
}
