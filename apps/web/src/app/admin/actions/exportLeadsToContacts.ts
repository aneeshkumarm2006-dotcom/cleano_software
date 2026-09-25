"use server";

/**
 * "Export hot leads to contact records" — client feedback item 19, Stage 11.1.
 * The gate; the work is `runLeadExport` in `src/lib/lead-export.ts`, which
 * documents the created / linked / skipped rules.
 */

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { runLeadExport, type LeadExportResult } from "@/lib/lead-export";

export async function exportLeadsToContacts(
  leadIds: string[]
): Promise<({ success: true } & LeadExportResult) | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") return { error: "Not authorized" };

  if (!Array.isArray(leadIds) || leadIds.length === 0) return { error: "No leads selected" };

  try {
    const result = await runLeadExport(leadIds, session.user.name ?? "Admin");
    revalidatePath("/admin/leads");
    revalidatePath("/admin/contacts");
    return { success: true, ...result };
  } catch (e) {
    console.error("exportLeadsToContacts", e);
    return { error: "Failed to export leads to contacts" };
  }
}
