"use server";

import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { SAVED_ADDRESS_ORDER } from "@/lib/client-address-store";

/**
 * Customers (and their saved locations) offered by the checklist template
 * editor's scope pickers — Stage 10 / PDF #10, step 10.4.
 *
 * Fetched LAZILY when the template modal opens rather than loaded with the
 * Settings page. Settings already issues thirteen parallel reads on every open,
 * and the address book is a per-customer relation: pulling the whole client
 * list plus every address into a page where most admins are editing a tax rate
 * would be the largest query on the page, for a control almost nobody touches.
 *
 * The template LIST does not depend on this — the chips render from the client
 * name the page already joins onto each template, so scope stays visible even
 * if this action is never called.
 */
export interface ChecklistScopeClient {
  id: string;
  name: string;
  addresses: { id: string; label: string; address: string }[];
}

export async function getChecklistScopeOptions(): Promise<
  | { success: true; clients: ChecklistScopeClient[] }
  | { success: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  // Same OWNER/ADMIN gate as create/updateChecklistTemplate — there is no point
  // offering a picker to someone the write would reject.
  if (role !== "OWNER" && role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  try {
    const clients = await db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        addresses: {
          orderBy: SAVED_ADDRESS_ORDER,
          select: { id: true, label: true, address: true },
        },
      },
    });
    return { success: true, clients };
  } catch (error) {
    console.error("getChecklistScopeOptions failed", error);
    return { success: false, error: "Could not load customers" };
  }
}
