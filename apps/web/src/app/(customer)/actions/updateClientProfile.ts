"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { syncContactFromClient } from "@/lib/crm";

interface UpdateInput {
  name?: string;
  phone?: string;
  // `address` was deliberately removed (awerfixes.pdf item 2, round 3, stage 4).
  // The portal's single "Default address" textbox became the saved-address book
  // in app/(customer)/actions/clientAddresses.ts. The flat `Client.address`
  // scalar is now written only when a brand-new client is created, so nothing
  // silently overwrites a customer's address again.
}

export async function updateClientProfile(input: UpdateInput) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { success: false, error: "Not authenticated" };

    const email = session.user.email?.toLowerCase();
    if (!email) return { success: false, error: "Session has no email" };

    const client = await db.client.findFirst({ where: { email } });
    if (!client) return { success: false, error: "Client record not found" };

    const data: Record<string, string> = {};
    if (input.name !== undefined && input.name.trim()) {
      data.name = input.name.trim();
    }
    if (input.phone !== undefined) data.phone = input.phone.trim();

    await db.client.update({ where: { id: client.id }, data });

    // CRM-006: mirror identity changes onto the linked CRM contact.
    await syncContactFromClient(client.id);

    // Keep User.name in sync if provided.
    if (data.name) {
      await db.user.update({
        where: { id: session.user.id },
        data: { name: data.name },
      });
    }

    revalidatePath("/");
    revalidatePath("/account");
    return { success: true };
  } catch (error) {
    console.error("Error updating client profile:", error);
    return { success: false, error: "Failed to update profile" };
  }
}
