"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { sendAccountEmail } from "@/lib/email";

// Called right after a Better Auth sign-up for a client. Promotes the user's
// role to CLIENT and either links to an existing Client record (matched by
// email) or creates a fresh Client row from the signup form's name/phone/
// address. Without this, brand-new customers see "No client record linked"
// on the portal Account page.
export async function linkClientAccount(input?: {
  phone?: string;
  address?: string;
}) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const userId = session.user.id;
    const email = session.user.email?.toLowerCase();
    if (!email) return { success: false, error: "Session has no email" };
    const name = session.user.name ?? email;
    const phone = input?.phone?.trim() || null;
    const address = input?.address?.trim() || null;

    // Set role to CLIENT (most accounts default to EMPLOYEE).
    await db.user.update({
      where: { id: userId },
      data: { role: "CLIENT" },
    });

    // Find the Client record by email and link userId.
    const existing = await db.client.findFirst({ where: { email } });

    if (existing) {
      // If already linked to a different user, leave it alone.
      if (existing.userId && existing.userId !== userId) {
        return { success: true, alreadyLinked: true };
      }
      await db.client.update({
        where: { id: existing.id },
        data: {
          userId,
          // Fill in any blank fields we just collected from signup, but
          // don't overwrite values an admin already set.
          ...(existing.phone ? {} : phone ? { phone } : {}),
          ...(existing.address ? {} : address ? { address } : {}),
        },
      });
    } else {
      // Brand-new customer: create the Client record now so the portal
      // Account page renders their profile immediately.
      await db.client.create({
        data: {
          userId,
          name,
          email,
          phone,
          address,
          clientType: "RESIDENTIAL",
          isActive: true,
        },
      });
    }

    // Welcome the customer — gated by `cust.account.new` + `cust.account.activated`.
    sendAccountEmail({
      to: email,
      name: session.user.name ?? email,
      role: "CUSTOMER",
      event: "new_account",
    }).catch((e) => console.error("customer new-account email", e));
    sendAccountEmail({
      to: email,
      name: session.user.name ?? email,
      role: "CUSTOMER",
      event: "activated",
    }).catch((e) => console.error("customer activated email", e));

    return { success: true };
  } catch (error) {
    console.error("Error linking client account:", error);
    return { success: false, error: "Failed to link account" };
  }
}
