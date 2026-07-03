"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

// Entities that support soft-delete bulk actions. Value = Prisma model delegate
// key on `db`; path = what to revalidate after a change.
const ENTITIES = {
  job: { model: "job", path: "/admin/jobs" },
  client: { model: "client", path: "/admin/clients" },
  employee: { model: "user", path: "/admin/employees" },
  lead: { model: "lead", path: "/admin/leads" },
  waitlist: { model: "waitlist", path: "/admin/waitlist" },
  jobApplication: { model: "jobApplication", path: "/admin/job-applications" },
  product: { model: "product", path: "/admin/inventory" },
  invoice: { model: "invoice", path: "/admin/invoices" },
  contact: { model: "contact", path: "/admin/contacts" },
  quote: { model: "quoteRequest", path: "/admin/quotes" },
  giftCard: { model: "giftCard", path: "/admin/gift-cards" },
  promoCode: { model: "promoCode", path: "/admin/promo-codes" },
} as const;

export type BulkEntity = keyof typeof ENTITIES;

type Result = { success: true; count: number } | { success: false; error: string };

async function requireStaff(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true };
}

function sanitizeIds(ids: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter((id) => typeof id === "string" && id)));
}

// Soft-delete many rows of an entity (sets deletedAt). Recoverable via bulkRestore.
export async function bulkSoftDelete(entity: BulkEntity, ids: string[]): Promise<Result> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  const cfg = ENTITIES[entity];
  if (!cfg) return { success: false, error: "Unknown entity" };
  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const delegate = (db as unknown as Record<string, any>)[cfg.model];
    const res = await delegate.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    revalidatePath(cfg.path);
    return { success: true, count: res.count };
  } catch (e) {
    console.error(`bulkSoftDelete(${entity})`, e);
    return { success: false, error: "Failed to delete selected items" };
  }
}

// Restore many soft-deleted rows (clears deletedAt).
export async function bulkRestore(entity: BulkEntity, ids: string[]): Promise<Result> {
  const gate = await requireStaff();
  if (!gate.ok) return { success: false, error: gate.error };

  const cfg = ENTITIES[entity];
  if (!cfg) return { success: false, error: "Unknown entity" };
  const cleanIds = sanitizeIds(ids);
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  try {
    const delegate = (db as unknown as Record<string, any>)[cfg.model];
    const res = await delegate.updateMany({
      where: { id: { in: cleanIds }, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    revalidatePath(cfg.path);
    return { success: true, count: res.count };
  } catch (e) {
    console.error(`bulkRestore(${entity})`, e);
    return { success: false, error: "Failed to restore selected items" };
  }
}
