"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";
import { InvoiceStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { syncJobsForInvoiceStatus } from "@/lib/invoice-sync";

type Result = { success: true; count: number } | { success: false; error: string };

// Bulk-set Invoice.status for the selected ids. Gated on staff roles like the
// other admin bulk actions. Validates the requested status against the
// InvoiceStatus enum, then applies it with a single updateMany.
export async function bulkSetInvoiceStatus(
  ids: string[],
  status: string
): Promise<Result> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { success: false, error: "Not authenticated" };

  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { success: false, error: "Not authorized" };
  }

  if (!Object.values(InvoiceStatus).includes(status as InvoiceStatus)) {
    return { success: false, error: "Invalid invoice status" };
  }
  const nextStatus = status as InvoiceStatus;

  const cleanIds = Array.from(
    new Set((ids ?? []).filter((id) => typeof id === "string" && id))
  );
  if (cleanIds.length === 0) return { success: false, error: "Nothing selected" };

  const data: Prisma.InvoiceUpdateManyMutationInput = { status: nextStatus };
  // Keep paidAt consistent with the paid state.
  if (nextStatus === InvoiceStatus.PAID) data.paidAt = new Date();
  else if (nextStatus === InvoiceStatus.CANCELLED) data.paidAt = null;

  try {
    // Snapshot prior statuses so the per-invoice job sync knows the transition.
    const prior = await db.invoice.findMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      select: { id: true, status: true },
    });
    const res = await db.invoice.updateMany({
      where: { id: { in: cleanIds }, deletedAt: null },
      data,
    });
    // Invoice → job sync (spec item 10) for each invoice that actually moved.
    for (const inv of prior) {
      await syncJobsForInvoiceStatus(inv.id, nextStatus, inv.status).catch((e) =>
        console.error("bulk invoice job sync", inv.id, e)
      );
    }
    revalidatePath("/admin/invoices");
    revalidatePath("/admin/jobs");
    return { success: true, count: res.count };
  } catch (e) {
    console.error("bulkSetInvoiceStatus", e);
    return { success: false, error: "Failed to update selected invoices" };
  }
}
