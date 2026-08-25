"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { logActivity } from "@/lib/activity-log";

// "Send login invite" — emails a secure set-password link (better-auth password
// reset) to people who have NOT yet logged in. Already-active accounts (they've
// signed in at least once → lastSeenAt set) are skipped unless `force` is set.
// Works for customers (Client → their CLIENT user login) and cleaners (User).

export type InviteEntity = "customer" | "cleaner";

export interface InviteResult {
  success: boolean;
  error?: string;
  sent: number;
  skippedActive: number; // already logged in
  skippedNoEmail: number;
  createdLogins: number; // customers that had no login yet
}

async function requireStaff() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false as const, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false as const, error: "Not authorized" };
  }
  return { ok: true as const };
}

// A person counts as "already logged in" once they've signed in at least once
// (lastSeenAt is set). Never-signed-in accounts are eligible for an invite.
type Target = { userId: string; email: string; name: string; loggedIn: boolean };

export async function sendLoginInvites(
  entity: InviteEntity,
  ids: string[],
  opts?: { force?: boolean }
): Promise<InviteResult> {
  const gate = await requireStaff();
  const base: InviteResult = {
    success: false,
    sent: 0,
    skippedActive: 0,
    skippedNoEmail: 0,
    createdLogins: 0,
  };
  if (!gate.ok) return { ...base, error: gate.error };

  const cleanIds = Array.from(new Set((ids ?? []).filter(Boolean)));
  if (cleanIds.length === 0) return { ...base, error: "Nothing selected" };

  const force = opts?.force === true;
  const targets: Target[] = [];
  let createdLogins = 0;
  let skippedNoEmail = 0;

  if (entity === "cleaner") {
    const users = await db.user.findMany({
      where: { id: { in: cleanIds }, role: { not: "CLIENT" } },
      select: { id: true, email: true, name: true, lastSeenAt: true },
    });
    for (const u of users) {
      if (!u.email) { skippedNoEmail++; continue; }
      targets.push({ userId: u.id, email: u.email, name: u.name, loggedIn: u.lastSeenAt != null });
    }
  } else {
    // Customers: ids are Client ids. Resolve (or create) their CLIENT login.
    const clients = await db.client.findMany({
      where: { id: { in: cleanIds } },
      select: { id: true, name: true, email: true, userId: true },
    });
    const linkedUserIds = clients
      .map((c) => c.userId)
      .filter((v): v is string => !!v);
    const linkedUsers = linkedUserIds.length
      ? await db.user.findMany({
          where: { id: { in: linkedUserIds } },
          select: { id: true, email: true, name: true, lastSeenAt: true },
        })
      : [];
    const userById = new Map(linkedUsers.map((u) => [u.id, u]));

    for (const c of clients) {
      const linked = c.userId ? userById.get(c.userId) : undefined;
      if (linked) {
        if (!linked.email) { skippedNoEmail++; continue; }
        targets.push({
          userId: linked.id,
          email: linked.email,
          name: linked.name,
          loggedIn: linked.lastSeenAt != null,
        });
        continue;
      }
      // No login yet — create a CLIENT user so we can invite them. They set
      // their own password via the emailed link (no temp password stored).
      if (!c.email) { skippedNoEmail++; continue; }
      const existingByEmail = await db.user.findUnique({
        where: { email: c.email.toLowerCase() },
        select: { id: true, email: true, name: true, lastSeenAt: true },
      });
      if (existingByEmail) {
        await db.client.update({ where: { id: c.id }, data: { userId: existingByEmail.id } });
        targets.push({
          userId: existingByEmail.id,
          email: existingByEmail.email,
          name: existingByEmail.name,
          loggedIn: existingByEmail.lastSeenAt != null,
        });
        continue;
      }
      const created = await db.user.create({
        data: {
          name: c.name,
          email: c.email.toLowerCase(),
          role: "CLIENT",
          emailVerified: true,
          mustChangePassword: true,
        },
        select: { id: true, email: true, name: true },
      });
      await db.client.update({ where: { id: c.id }, data: { userId: created.id } });
      createdLogins++;
      targets.push({ userId: created.id, email: created.email, name: created.name, loggedIn: false });
    }
  }

  // Filter: skip people who have already logged in, unless force re-send.
  const eligible = force ? targets : targets.filter((t) => !t.loggedIn);
  const skippedActive = targets.length - eligible.length;

  let sent = 0;
  for (const t of eligible) {
    try {
      // better-auth generates a reset token and emails the set-password link
      // (see sendResetPassword in src/lib/auth.ts). Reused so no token/temp
      // password is ever stored by us.
      await auth.api.requestPasswordReset({
        body: { email: t.email, redirectTo: "/reset-password" },
      });
      sent++;
    } catch (e) {
      console.error("sendLoginInvite", t.email, e);
    }
  }

  await logActivity({
    category: "EMAIL",
    action: "login_invite",
    status: "SUCCESS",
    message: `Login invites: ${sent} sent, ${skippedActive} skipped (already active), ${skippedNoEmail} no email${createdLogins ? `, ${createdLogins} logins created` : ""}.`,
  });

  return {
    success: true,
    sent,
    skippedActive,
    skippedNoEmail,
    createdLogins,
  };
}
